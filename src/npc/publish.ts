/**
 * publish.ts — publishing a marketplace listing from the browser, signed with your own wallet.
 *
 * WHY THIS EXISTS (NEXT-PHASES.md P1#5). services/registry has always accepted listings over a
 * real public API — content-addressed, ed25519-signed, artifact re-hashed on every read — and the
 * only clients were a CLI and a curl command. The `/agents` page could read the marketplace and
 * not add to it, which makes "it is a real public API" a claim rather than a thing anybody can do.
 *
 * THE ONE DESIGN DECISION WORTH THE COMMENT: THE SERVER OWNS THE BYTES THAT GET SIGNED.
 *
 * A listing's signature covers `listingStateText(id, digest, seq, expiresAt)`, where `id` is a
 * sha256 over the canonical JSON of the document's identity and `digest` is a sha256 over the
 * canonical JSON of the whole document. The obvious client re-implements `canonicalJson`, the id
 * derivation and the digest — and then there are two implementations of an exact-bytes contract,
 * which drift the first time either side adds a field. Every listing published by a drifted client
 * is refused with a signature error that looks like a wallet problem.
 *
 * So this does not compute any of it. It POSTs the document with NO signature, and the registry
 * answers 401 with the exact `signedMessage` it expects (registry.ts surfaces `signedMessage` on
 * every failed plan for precisely this reason). We sign THAT string and post again. One
 * implementation of the canonical encoding, on the side that also verifies it.
 *
 * The artifact hash IS computed here — from the file's own bytes with WebCrypto — because that one
 * is not a protocol encoding, it is a fact about the file, and the registry re-hashes the bytes it
 * receives and refuses a mismatch anyway.
 *
 * TWO SIGNATURES, DELIBERATELY. A create stores the listing as `pending`, which no read serves;
 * publishing is a second signed write that sets `status: "listed"` at the next seq. That is the
 * registry's design, not an accident of this client — a mis-typed listing is never public — so
 * this flow surfaces it as two clearly-named steps rather than hiding one behind the other.
 */
import { REGISTRY, apiDeadline, isBase58Address, throttleRetryMs } from './config.ts';
import { bs58encode, provider } from './identity.ts';

/** The closed vocabularies, mirrored from services/registry/listings.ts. */
export const LISTING_KINDS = ['character', 'voice', 'plugin'] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

/**
 * MIRRORED, and guarded by a test that reads the registry's own source (see
 * __tests__/publishListing.spec.ts). The front end is a separate npm package and cannot import
 * across the workspace boundary, so this list is a copy — and a copy of a CLOSED VOCABULARY is
 * exactly the thing that rots: the registry refuses an unknown licence with a 422, so a value
 * added there and not here is a licence nobody can pick, and a value here and not there is a
 * dropdown entry that always fails.
 */
export const LISTING_LICENSES = [
  'MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC', 'MPL-2.0', 'GPL-3.0-only', 'AGPL-3.0-only',
  'CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'proprietary',
] as const;
export type ListingLicense = (typeof LISTING_LICENSES)[number];

export const LISTING_CURRENCIES = ['SOL', 'USDC'] as const;
export type ListingCurrency = (typeof LISTING_CURRENCIES)[number];

/** Artifact ceiling, mirrored from the registry. Checked here so a 3 MB file fails instantly. */
export const MAX_ARTIFACT_BYTES = 48 * 1024;

/**
 * How long the signed write stays valid. The registry's own ceiling is 10 minutes; four is well
 * inside it and still leaves room for a person reading two wallet dialogs.
 */
export const SIGN_TTL_MS = 4 * 60_000;

/** Minor units per whole unit, per currency — lamports for SOL, micro-USDC for USDC. */
export const MINOR_UNITS: Record<ListingCurrency, number> = { SOL: 1_000_000_000, USDC: 1_000_000 };

export interface ListingDraft {
  kind: ListingKind;
  title: string;
  summary: string;
  license: ListingLicense;
  /** Whole units as the user typed them (e.g. "0.5"). Converted to integer minor units below. */
  price: string;
  currency: ListingCurrency;
}

export type PublishResult =
  | { ok: true; id: string; note: string }
  | { ok: false; why: string };

/**
 * PURE. Whole units → integer minor units, or null when the string is not a price.
 *
 * The registry demands an INTEGER in minor units, so this is where a decimal becomes lamports.
 * Rounding is the whole risk: `0.1 * 1e9` is 100000000.00000001 in binary floating point, and
 * `Math.round` is what stops that reaching the wire as a non-integer the registry refuses. A
 * negative, a NaN or more precision than the currency has are all refusals rather than guesses —
 * this is a price somebody may be asked to pay.
 */
export function toMinorUnits(price: string, currency: ListingCurrency): number | null {
  const t = String(price ?? '').trim();
  if (t === '') return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  const scaled = Math.round(n * MINOR_UNITS[currency]);
  if (!Number.isSafeInteger(scaled)) return null;
  // More decimals than the currency can express is not a price this registry can store, and
  // silently truncating somebody's asking price is worse than refusing it.
  const decimals = t.includes('.') ? t.split('.')[1]!.length : 0;
  if (decimals > String(MINOR_UNITS[currency]).length - 1) return null;
  return scaled;
}

/** PURE. The complaints a draft has, in the order a person would fix them. Empty means valid. */
export function draftProblems(d: ListingDraft, artifactBytes: number | null): string[] {
  const out: string[] = [];
  if (!LISTING_KINDS.includes(d.kind)) out.push('pick what kind of thing this is.');
  if (!d.title.trim()) out.push('a title is required.');
  if (!d.summary.trim()) out.push('a one-line summary is required.');
  if (!LISTING_LICENSES.includes(d.license)) out.push('pick a licence.');
  if (toMinorUnits(d.price, d.currency) === null) out.push('price must be a number — use 0 for free.');
  if (artifactBytes === null) out.push('choose the file people are getting.');
  else if (artifactBytes === 0) out.push('that file is empty.');
  else if (artifactBytes > MAX_ARTIFACT_BYTES) {
    out.push(`that file is ${artifactBytes.toLocaleString('en-US')} bytes; the registry stores at most ${MAX_ARTIFACT_BYTES.toLocaleString('en-US')}.`);
  }
  return out;
}

/** sha256 (hex) of raw bytes, via WebCrypto. The one hash this client computes — see the header. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * PURE. Standard base64 of raw bytes — no base64url, canonical padding, which is what the
 * registry's decoder accepts. Chunked because `String.fromCharCode(...bytes)` on a 48 KB array
 * overflows the argument limit in some engines, which shows up as a crash on a big file only.
 */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

/** The document the registry stores and re-serves verbatim. Exactly these keys. */
export interface ListingDoc {
  schema: 'kamiko.listing';
  version: 1;
  kind: ListingKind;
  publisher: string;
  title: string;
  summary: string;
  license: ListingLicense;
  price: { amount: number; currency: ListingCurrency };
  artifactSha256: string;
  artifactBytes: number;
  status: 'pending' | 'listed';
}

/** PURE. Assemble the document. Trimmed, because the registry stores what it is sent, verbatim. */
export function buildListingDoc(
  d: ListingDraft,
  publisher: string,
  artifactSha256: string,
  artifactBytes: number,
  status: 'pending' | 'listed',
): ListingDoc {
  return {
    schema: 'kamiko.listing',
    version: 1,
    kind: d.kind,
    publisher,
    title: d.title.trim(),
    summary: d.summary.trim(),
    license: d.license,
    price: { amount: toMinorUnits(d.price, d.currency) ?? 0, currency: d.currency },
    artifactSha256,
    artifactBytes,
    status,
  };
}

/** One POST to the registry, with every failure turned into a sentence. Never throws. */
async function post(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> } | { why: string }> {
  if (!REGISTRY) return { why: 'no registry configured (NEXT_PUBLIC_NPC_REGISTRY unset)' };
  let res: Response;
  try {
    res = await fetch(`${REGISTRY}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: apiDeadline(),
    });
  } catch (e) {
    return { why: `could not reach the registry at ${REGISTRY} (${e instanceof Error ? e.message : 'network error'})` };
  }
  const wait = await throttleRetryMs(res);
  if (wait !== null) return { why: `the registry is rate-limiting writes — wait about ${Math.round(wait / 1000)}s and try again` };
  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { parsed = null; }
  return { status: res.status, body: (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown> };
}

/**
 * PURE. Pull the message to sign out of a probe reply.
 *
 * A probe is EXPECTED to fail with 401 and carry `signedMessage`. Anything else — a 200 (the
 * registry accepted an unsigned write, which would be a serious server bug), a 409 (already
 * listed), a 422 (the document is malformed) — is a real answer that must be surfaced as itself
 * rather than retried with a signature that could not help.
 */
export function readProbe(reply: { status: number; body: Record<string, unknown> }): { ok: true; message: string; id: string; seq: number } | { ok: false; why: string } {
  const b = reply.body;
  const message = typeof b.signedMessage === 'string' ? b.signedMessage : '';
  const id = typeof b.id === 'string' ? b.id : '';
  const seq = typeof b.expectedSeq === 'number' ? b.expectedSeq : NaN;
  if (reply.status === 200) {
    return { ok: false, why: 'the registry accepted an unsigned write — refusing to continue, because that is not how this API is meant to behave.' };
  }
  if (!message || !id || !Number.isSafeInteger(seq)) {
    const err = typeof b.error === 'string' ? b.error : `HTTP ${reply.status}`;
    return { ok: false, why: `the registry refused this listing: ${err}` };
  }
  return { ok: true, message, id, seq };
}

/** Connect the wallet and sign one message. Returns the base58 signature and the signer key. */
async function signWith(message: string, onStatus: (s: string) => void): Promise<{ ok: true; signature: string; signer: string } | { ok: false; why: string }> {
  const p = provider();
  if (!p) return { ok: false, why: 'no Solana wallet found in this browser — install Phantom to sign, then try again.' };
  let signer = '';
  try {
    onStatus('connect your wallet…');
    const resp = await p.connect();
    signer = resp?.publicKey?.toString?.() || '';
  } catch {
    return { ok: false, why: 'wallet connection was cancelled — nothing was published.' };
  }
  if (!isBase58Address(signer)) return { ok: false, why: 'the wallet returned no usable public key — nothing was published.' };
  try {
    const signed = await p.signMessage(new TextEncoder().encode(message), 'utf8');
    return { ok: true, signature: bs58encode(signed.signature), signer };
  } catch {
    return { ok: false, why: 'you declined the signature — nothing was published.' };
  }
}

/** The wallet's public key, so the document can name its publisher before anything is signed. */
export async function connectPublisher(): Promise<{ ok: true; publisher: string } | { ok: false; why: string }> {
  const p = provider();
  if (!p) return { ok: false, why: 'no Solana wallet found in this browser — install Phantom to publish a listing.' };
  try {
    const resp = await p.connect();
    const key = resp?.publicKey?.toString?.() || '';
    if (!isBase58Address(key)) return { ok: false, why: 'the wallet returned no usable public key.' };
    return { ok: true, publisher: key };
  } catch {
    return { ok: false, why: 'wallet connection was cancelled.' };
  }
}

/** Probe → sign → commit, for one signed listing write. `path` is create or update. */
async function signedWrite(
  path: string,
  doc: ListingDoc,
  artifactB64: string | null,
  onStatus: (s: string) => void,
  nowMs: number,
): Promise<{ ok: true; id: string; body: Record<string, unknown> } | { ok: false; why: string }> {
  const expiresAt = nowMs + SIGN_TTL_MS;
  // The probe carries the REAL expiresAt: the deadline is bound into the signed message, so a
  // probe with a placeholder would hand back a string that is not the one the commit needs.
  const base = { listing: doc, expiresAt, ...(artifactB64 === null ? {} : { artifact: artifactB64 }) };
  const probe = await post(path, base);
  if ('why' in probe) return { ok: false, why: probe.why };
  const read = readProbe(probe);
  if (!read.ok) return { ok: false, why: read.why };

  const signed = await signWith(read.message, onStatus);
  if (!signed.ok) return { ok: false, why: signed.why };

  onStatus('sending it to the registry…');
  const commit = await post(path, { ...base, seq: read.seq, signature: signed.signature, signer: signed.signer });
  if ('why' in commit) return { ok: false, why: commit.why };
  if (commit.status < 200 || commit.status >= 300) {
    const err = typeof commit.body.error === 'string' ? commit.body.error : `HTTP ${commit.status}`;
    return { ok: false, why: `the registry refused this listing: ${err}` };
  }
  return { ok: true, id: read.id, body: commit.body };
}

/**
 * The whole flow: hash the file, create it as `pending`, then publish it as `listed`.
 *
 * TWO WALLET SIGNATURES, and the status text says so before the first one — a person who is asked
 * to approve a second dialog they were not told about assumes something went wrong.
 */
export async function publishListing(
  draft: ListingDraft,
  publisher: string,
  artifact: Uint8Array,
  onStatus: (s: string) => void,
  now: () => number = () => Date.now(),
): Promise<PublishResult> {
  const problems = draftProblems(draft, artifact.byteLength);
  if (problems.length) return { ok: false, why: problems[0]! };
  if (!isBase58Address(publisher)) return { ok: false, why: 'connect a wallet first — it is the only key that will ever be able to edit this listing.' };

  onStatus('hashing your file…');
  const artifactSha256 = await sha256Hex(artifact);
  const artifactB64 = toBase64(artifact);

  onStatus('step 1 of 2 — sign to create the listing (it stays private until step 2)…');
  const created = await signedWrite(
    '/listings',
    buildListingDoc(draft, publisher, artifactSha256, artifact.byteLength, 'pending'),
    artifactB64,
    onStatus,
    now(),
  );
  if (!created.ok) return { ok: false, why: created.why };

  /*
   * THE SECOND WRITE IS THE PUBLICATION. A create is stored `pending` and no read serves it, which
   * is the registry's way of making sure a mis-typed listing is never public. The update carries
   * the same document with `status: "listed"` — and NO artifact, because the bytes are already
   * stored and the content address pins them; re-sending them would only be a second chance to
   * send different ones.
   */
  onStatus('step 2 of 2 — sign to publish it…');
  const listed = await signedWrite(
    `/listings/${created.id}/update`,
    buildListingDoc(draft, publisher, artifactSha256, artifact.byteLength, 'listed'),
    null,
    onStatus,
    now(),
  );
  if (!listed.ok) {
    return {
      ok: false,
      // The create SUCCEEDED. Saying "publishing failed" without saying that would send somebody
      // back to step 1, where the registry correctly answers 409 and they conclude it is broken.
      why: `${listed.why} Your listing was created but is still private — sign step 2 again to publish it.`,
    };
  }
  return { ok: true, id: created.id, note: 'Published. Every read re-hashes your artifact and re-verifies your signature.' };
}
