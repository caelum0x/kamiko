/**
 * config.ts — the runtime configuration every $KAMIKO funnel surface inside amica reads, resolved once.
 *
 * Amica is entirely env-configured (Next.js inlines NEXT_PUBLIC_* at build time) and
 * tooling/scripts/amica-preset.ts is what writes these into .env.local from the project's own
 * sources. Resolving them HERE — rather than reading process.env at each call site — is the same
 * rule the deleted funnel app learned the hard way: when every page reads its own global, one page
 * eventually disagrees with another about where the API is, and the money page is the one that
 * cannot afford to.
 *
 * The two hard rules, both about the tip:
 *
 *   - THE TIP DESTINATION IS CONFIGURATION ONLY. It is never read from the URL. The old holder page
 *     accepted `?tip=`, so `holder?tip=<attacker>` built and signed a REAL mainnet transfer to a
 *     stranger while the page said the user had tipped $KAMIKO — and npc-api then refused to credit it,
 *     because it verifies the destination. The victim lost the SOL and got nothing.
 *   - AN UNPARSEABLE VALUE IS "NOT CONFIGURED", never "close enough". A tip address that is not
 *     base58 leaves tipping OFF with a reason on screen, which is what services/game-api's own
 *     resolveTipWallet does on the server for the same input.
 */

/** PURE. base58, 32–44 chars — the shape of a Solana address. Not a claim that it exists. */
export function isBase58Address(s: unknown): s is string {
  return typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

const trimSlash = (s: string): string => s.replace(/\/+$/, '');

/**
 * The npc-api origin these pages talk to — the bridge, which proxies services/game-api.
 * '' means "not configured": every read fails closed and the pages say so rather than guessing an
 * origin (a wrong guess here is a page silently talking to the visitor's own machine).
 */
export const API = trimSlash(process.env.NEXT_PUBLIC_NPC_API || '');

/**
 * The kamiko.fun registry origin (services/registry, :8790 by default) that the /agents directory
 * and marketplace pages read. Resolved here for the same reason API is: one module decides where
 * the registry lives, not each page. '' means "not configured" and the pages say exactly that —
 * an empty directory and an unreachable registry are different states, and both are stated
 * honestly rather than guessed around.
 */
export const REGISTRY = trimSlash(process.env.NEXT_PUBLIC_NPC_REGISTRY || '');

/**
 * The SOL tip destination. Must equal `NPC_TIP_WALLET` on services/game-api — the api credits ONLY
 * a transfer it can read back off the chain as going to its own configured address. '' disables
 * tipping in the UI, which is the honest state when we cannot build a transfer the api will accept.
 */
export const TIP_WALLET = isBase58Address(process.env.NEXT_PUBLIC_NPC_TIP_WALLET)
  ? (process.env.NEXT_PUBLIC_NPC_TIP_WALLET as string)
  : '';

/**
 * PURE. Read a positive number out of an inlined NEXT_PUBLIC_ env, falling back on anything that is
 * not one.
 *
 * These bound REAL MAINNET TRANSFERS, so "unset", "empty", "0.1.2" and "-3" must all land on the
 * built-in default rather than on NaN. A NaN ceiling compares false against every amount, which is
 * the one direction that silently REMOVES the limit — the failure mode a tip cap exists to prevent.
 */
export function positiveEnvNumber(raw: unknown, fallback: number): number {
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * THE BOUNDS ON A TIP, checked in JS before the wallet is ever opened.
 *
 * `<input type="number" min="0.01" step="0.01">` on the holder page is markup on a React controlled
 * input: nothing in the submit path consults it, no form is submitted and `checkValidity()` is never
 * called, so a pasted or typed value goes straight through. The only guard the page had was
 * `sol > 0`, which accepts 100 SOL as readily as 0.1 — and one missing decimal point on a page whose
 * own rule is "after the signature exists, real mainnet SOL has been broadcast" is unrecoverable.
 *
 * MAX_TIP_SOL is a REFUSAL (the page will not build that transaction at all) and
 * TIP_CONFIRM_SOL is a SPEED BUMP (the page states the amount and the destination and waits for a
 * second, deliberate press). Both are overridable per deployment, because a ceiling that is too low
 * for its operator is a ceiling the operator removes from the source.
 */
export const MIN_TIP_SOL = positiveEnvNumber(process.env.NEXT_PUBLIC_NPC_MIN_TIP_SOL, 0.01);
export const MAX_TIP_SOL = positiveEnvNumber(process.env.NEXT_PUBLIC_NPC_MAX_TIP_SOL, 10);
export const TIP_CONFIRM_SOL = positiveEnvNumber(process.env.NEXT_PUBLIC_NPC_TIP_CONFIRM_SOL, 1);

/**
 * Solana RPC used to fetch a blockhash for the tip transaction. Empty falls back to the public
 * mainnet endpoint, which is rate-limited — a deployment that expects real tips sets its own.
 */
export const RPC = trimSlash(process.env.NEXT_PUBLIC_NPC_RPC || '') || 'https://api.mainnet-beta.solana.com';

/**
 * VAPID public key of npc-api's push keypair (`NPC_VAPID_PUBLIC_KEY` there). '' means the
 * streak-saver offer is not rendered at all: a subscription minted against the wrong key is one the
 * server can never push to, so half-configured must look exactly like off.
 */
export const VAPID = (process.env.NEXT_PUBLIC_NPC_VAPID || '').trim();

/**
 * Deadline for every call this front end makes to the funnel API.
 *
 * Browsers apply no default fetch timeout, so a backend that accepts the socket and never answers
 * leaves the UI in its loading state indefinitely — the connect button stuck on "sign the message
 * to verify…", the tip settle loop parked on one attempt that will never resolve, the streak-saver
 * button spinning. Every one of those reads to the visitor as "this is broken and I do not know
 * why", which is worse than a stated failure they can retry.
 *
 * Deliberately generous: these are real network round trips through a proxy to a Solana RPC, and a
 * tight budget would cancel work that was going to succeed. It is a ceiling on hanging, not a
 * performance target.
 */
export const API_TIMEOUT_MS = 15_000;

/**
 * An AbortSignal for one API call. Never throws, and returns `undefined` where `AbortSignal.timeout`
 * is unavailable — an older browser must still be able to use the site, just without the ceiling.
 */
export function apiDeadline(ms: number = API_TIMEOUT_MS): AbortSignal | undefined {
  try {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(ms)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read a JSON response from the funnel API, honouring a 429.
 *
 * services/game-api now rate-limits its public GET routes (it did not when these poll loops were
 * written), and a throttled response is JSON with a `Retry-After` header — so `(await
 * fetch(...)).json()` succeeds and hands the caller `{error: 'rate limited'}`, which every one of
 * these loops was treating as a normal payload or a parse failure and then RETRYING ON ITS NORMAL
 * INTERVAL. A page polling /leaderboard every 4s and /quests every 6s answers a throttle by
 * throttling harder, which is how a client turns its own rate limit into a permanent one.
 *
 * Returns `{ retryAfterMs }` instead of data when throttled, so the caller can back off and — this
 * is the part that matters on screen — leave the last good numbers up rather than blanking them.
 */
export type ApiRead<T> =
  | { ok: true; data: T }
  | { ok: false; throttled: true; retryAfterMs: number }
  | { ok: false; throttled: false };

/** Longest a 429 may park a poll loop, however large the server's Retry-After is. */
export const MAX_BACKOFF_MS = 60_000;

/**
 * How long a 429 asks us to wait, or null when this response is not a throttle.
 *
 * Split out of `readJson` because not every caller can afford `readJson`'s "any non-2xx is just a
 * failure" collapse: GET /trust answers a real, renderable report body with HTTP 503
 * (services/game-api/trust.ts:769 — "A report we could not build is a 503, not a 200 with a sad
 * payload"), and the trust page prints the `unavailable.detail` out of it. Those callers do their
 * own fetch and ask THIS function the one question they must not get wrong — is this a verdict, or
 * is it our own rate limiter? — so the 429 rule stays written once.
 *
 * Consumes the body on a throttle. That is safe: a throttled response carries no report.
 */
export async function throttleRetryMs(res: Response): Promise<number | null> {
  if (res.status !== 429) return null;
  // The header is authoritative; the body's own retryAfterSec is the fallback because the
  // bridge's proxy does not always relay response headers.
  const header = Number(res.headers.get('retry-after'));
  let seconds = Number.isFinite(header) && header > 0 ? header : 0;
  if (!seconds) {
    try {
      const body = (await res.json()) as { retryAfterSec?: unknown };
      const b = Number(body?.retryAfterSec);
      if (Number.isFinite(b) && b > 0) seconds = b;
    } catch {
      /* no readable body: fall through to the floor below */
    }
  }
  return Math.min(MAX_BACKOFF_MS, Math.max(1000, seconds * 1000));
}

export async function readJson<T>(url: string, init?: RequestInit): Promise<ApiRead<T>> {
  if (!API) return { ok: false, throttled: false };
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: init?.signal ?? apiDeadline() });
  } catch {
    return { ok: false, throttled: false };
  }
  const retryAfterMs = await throttleRetryMs(res);
  if (retryAfterMs !== null) return { ok: false, throttled: true, retryAfterMs };
  if (!res.ok) return { ok: false, throttled: false };
  try {
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, throttled: false };
  }
}

/* ------------------------------------------------------------------ *
 * The tip destination cross-check
 * ------------------------------------------------------------------ */

/**
 * What GET /config on services/game-api publishes. Every field is a value that is already public —
 * a base58 address anyone can read off the chain, a mint, a cluster label. It carries no key, no
 * RPC url and no secret, which is the only reason a browser is allowed to read it.
 */
export interface ApiConfig {
  /** The api's OWN configured NPC_TIP_WALLET, or null when tipping is off there. */
  tipWallet: string | null;
  /** The configured NPC_TOKEN_MINT, or null before launch. */
  mint: string | null;
  /** The Solana cluster label, e.g. 'mainnet-beta'. */
  cluster: string;
}

export type TipDestination =
  | { ok: true; wallet: string }
  /** This BUILD has no NEXT_PUBLIC_NPC_TIP_WALLET, so there is nothing to send to. */
  | { ok: false; kind: 'local-unconfigured'; why: string }
  /** The api has no NPC_TIP_WALLET, so it can credit no transfer at all. */
  | { ok: false; kind: 'api-unconfigured'; why: string }
  /** We could not ask. Not a verdict — but a tip is never urgent, so we still refuse. */
  | { ok: false; kind: 'unreachable'; why: string }
  /** The two addresses disagree. This is the one that burns the tipper's SOL. */
  | { ok: false; kind: 'mismatch'; why: string };

/**
 * PURE. Decide whether this build may build a transfer at all, given the api's own answer.
 *
 * THE FAILURE THIS PREVENTS, IN FULL: `TIP_WALLET` here is `NEXT_PUBLIC_NPC_TIP_WALLET`, inlined by
 * Next at BUILD time. services/game-api credits only a transfer it can read back off the chain as
 * going to its RUNTIME `NPC_TIP_WALLET`. The two are set at different moments, in different places,
 * by different mechanisms — a Docker build arg versus a fly secret — and until this function existed
 * nothing compared them. A mismatch (a rotated api wallet with no front-end rebuild is enough) meant
 * every tipper signed and broadcast REAL mainnet SOL to an address the api would then refuse with a
 * terminal 402, on which tip.ts's settleTip calls clearPending() and destroys the page's own record
 * of the signature. The SOL is gone, the tip is not credited, and the operator finds out from users.
 * infra/deploy/DEPLOY.md has stated this invariant in prose since the funnel shipped and enforced it
 * nowhere.
 *
 * It FAILS CLOSED, including on 'we could not ask'. A refused tip costs a retry; a burned tip is
 * unrecoverable, and the two are not close enough to trade off. Every refusal is a DIFFERENT `kind`
 * so the page can say which of them happened — "the operator's two addresses disagree" and "the api
 * did not answer" call for completely different actions from the person reading it.
 */
export function classifyTipDestination(local: string, read: ApiRead<ApiConfig>): TipDestination {
  if (!isBase58Address(local)) {
    return {
      ok: false,
      kind: 'local-unconfigured',
      why: 'tipping is off in this build: no tip address is configured (NEXT_PUBLIC_NPC_TIP_WALLET), so there is no destination npc-api would credit. nothing was sent.',
    };
  }
  if (!read.ok) {
    return {
      ok: false,
      kind: 'unreachable',
      why: read.throttled
        ? 'the api is rate-limiting this page, so it could not confirm where a tip must be sent. nothing has left your wallet — wait a moment and press Tip again.'
        : 'the api would not tell us where a tip must be sent, so this page will not build the transaction. nothing has left your wallet — try again in a moment.',
    };
  }
  const remote = read.data && typeof read.data === 'object' ? read.data.tipWallet : null;
  if (!isBase58Address(remote)) {
    return {
      ok: false,
      kind: 'api-unconfigured',
      why: 'the api has no tip wallet configured, so it could not credit any transfer at all. tipping is off until the operator sets NPC_TIP_WALLET. nothing was sent.',
    };
  }
  if (remote !== local) {
    return {
      ok: false,
      kind: 'mismatch',
      why:
        'REFUSED — this page would have sent your SOL to ' + local + ', but npc-api only credits transfers to ' + remote +
        '. that transfer would have been real, irreversible and never credited. nothing has left your wallet. tell the operator NEXT_PUBLIC_NPC_TIP_WALLET and NPC_TIP_WALLET disagree.',
    };
  }
  return { ok: true, wallet: remote };
}

/**
 * Ask the api where a tip must go, and compare it with this build's address.
 *
 * Called on every tip attempt rather than once per page: the answer is one small public read, and
 * caching it across a session would keep serving a stale address through exactly the rotation this
 * check exists to catch.
 */
export async function checkTipDestination(local: string = TIP_WALLET): Promise<TipDestination> {
  return classifyTipDestination(local, await readJson<ApiConfig>(API + '/config'));
}
