/**
 * agents.tsx — the kamiko.fun agent directory + marketplace, as an amica route.
 *
 * This is the first UI the registry (services/registry) has ever had: it reads /agents,
 * /agents/:ticker (+ /trust, /mentions), /listings and /graph from the origin configured as
 * NEXT_PUBLIC_NPC_REGISTRY, and renders them under the same fail-closed rules the /trust page
 * established:
 *
 *   - EVERY payload goes through the pure parsers in src/npc/registry.ts; an unrecognised shape
 *     renders as "unrecognised answer", never as a half-filled card.
 *   - The empty registry, the unreachable registry and the unconfigured registry are THREE
 *     different sentences, each stated as itself.
 *   - A 429 changes nothing on screen (the registry rate-limits reads); we note it and stop
 *     asking until the server said we may — same rule trust.tsx documents.
 *   - Badges are the registry's own words: a self-reported grade says "self-reported", an
 *     unverified mint says "creator claim". Nothing is upgraded in transit.
 *
 * Detail is selected client-side (?a=TICKER) rather than as a dynamic route: this app also builds
 * with `output: export` (Tauri), where a dynamic [ticker] route would need getStaticPaths over
 * data that lives in a runtime registry — a build-time list of runtime rows is exactly the kind of
 * fabrication the rest of this product refuses.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';

import { REGISTRY, apiDeadline, isBase58Address, throttleRetryMs } from '../npc/config.ts';
import { bs58encode, provider } from '../npc/identity.ts';
import {
  agentJsonUrl, gradeTone, isRegistryTicker, listingArtifactUrl, mintBadge, parseAgentDetail,
  parseAgentTrust, parseAgentsDirectory, parseGraph, parseListings, parseMentions, shortKey,
  type AgentDetail, type AgentSummary, type AgentTrustView, type BadgeTone, type ListingSummary,
  type Mention, type ParsedMentions,
} from '../npc/registry.ts';
import {
  LISTING_CURRENCIES,
  LISTING_KINDS as PUBLISH_KINDS,
  LISTING_LICENSES,
  MAX_ARTIFACT_BYTES,
  connectPublisher,
  draftProblems,
  publishListing,
  type ListingCurrency,
  type ListingDraft,
  type ListingKind as PublishKind,
  type ListingLicense,
} from '../npc/publish.ts';
import { NPC_CSS } from '../npc/styles.ts';

/* ------------------------------------------------------------------ *
 * Fetch plumbing — one shape for every section, so no section can invent a state.
 * ------------------------------------------------------------------ */

type Fetched<T> =
  | { state: 'loading' }
  | { state: 'error'; why: string }
  | { state: 'ok'; data: T };

const LOADING = { state: 'loading' } as const;

/**
 * GET one registry route and parse it with a PURE parser. Everything that can go wrong lands in
 * `error` with a sentence a stranger can act on. Honours a 429 by reporting how long to wait.
 */
async function readRegistry<T>(path: string, parse: (body: unknown) => T | null): Promise<Fetched<T> & { retryAfterMs?: number }> {
  if (!REGISTRY) return { state: 'error', why: 'no registry configured (NEXT_PUBLIC_NPC_REGISTRY unset)' };
  let res: Response;
  try {
    res = await fetch(REGISTRY + path, { headers: { accept: 'application/json' }, signal: apiDeadline() });
  } catch (e) {
    return { state: 'error', why: `could not reach the registry at ${REGISTRY} (${e instanceof Error ? e.message : 'network error'})` };
  }
  const wait = await throttleRetryMs(res);
  if (wait !== null) {
    return { state: 'error', why: `the registry is rate-limiting this page — retrying in about ${Math.round(wait / 1000)}s`, retryAfterMs: wait };
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const msg = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP ${res.status}`;
    return { state: 'error', why: `the registry answered: ${msg}` };
  }
  const parsed = parse(body);
  if (parsed === null) return { state: 'error', why: 'the registry answered with something this build does not recognise' };
  return { state: 'ok', data: parsed };
}

const TONE_COLOR: Record<BadgeTone, string> = { good: '#00ffa3', caution: '#ffb020', bad: '#ff2e63', unknown: '#7a7a92' };

/* ------------------------------------------------------------------ *
 * Registration — the browser half of tooling/scripts/seed-registry.ts.
 *
 * The registry admits anyone who signs the ownership claim for their ticker: an ed25519 ownership
 * signature over the canonical bytes it publishes at GET /pledge-text?ticker=TICKER, POSTed as
 * { character, pledge:{ signature, signer } } (the `pledge` key is kept for data compat).
 * seed-registry.ts signs with a server-side keypair; here the USER's Phantom wallet signs instead, so
 * the recorded signer is a key the registrant actually controls — the signature is pure ownership
 * proof, not a promise about how the token launches.
 *
 * Everything below FAILS CLOSED and never throws at the caller: a wallet the visitor does not have, a
 * signature they decline, a taken ticker and an unreachable registry are four different sentences, and
 * none of them leaves a half-finished registration behind.
 * ------------------------------------------------------------------ */

/** The minimal character a registrant supplies. Everything else is a safe default. */
interface RegistrationInput {
  ticker: string;
  name: string;
  tagline: string;
}

/**
 * A minimal VALID NpcCharacter (packages/character-kit/schema.ts validateCharacter) built from the
 * three fields a registrant types plus the flagship defaults. The safety guardrails are ON and not
 * offered as a choice — the registry rejects an unguarded agent, and so does this builder by never
 * emitting one.
 */
function buildCharacter(input: RegistrationInput) {
  const { ticker, name, tagline } = input;
  return {
    name,
    ticker,
    tagline,
    persona: {
      system: [
        `You are $${ticker} — ${name}, an AI-VTuber agent registered on kamiko.fun. ${tagline}`,
        'VOICE: 1-2 short lines, in character, meme-native.',
        'HARD RULES: never promise price/profit/returns; never give financial advice; never fake stats; keep it PG-13; be kind to the community.',
      ],
      bio: [tagline, `${name} — an AI-VTuber agent on kamiko.fun`],
      style: ['keep it to 1-2 short lines', 'never promise price/returns; never give financial advice', 'stay in character'],
    },
    avatar: { vrm: './npc.vrm', heterochromia: true },
    voice: { provider: 'browser' as const },
    // SAFETY INVARIANT — mirrors the flagship and what the registry enforces. Never weaken these.
    guardrails: { noFinancialAdvice: true as const, pg13: true as const, bannedTopics: [] as string[] },
    market: { chains: ['solana'], reactTo: ['ownToken', 'trending'] as Array<'sol' | 'trending' | 'ownToken' | 'quoteStock'> },
    tiers: [
      { name: 'sentient', minTokens: 1_000_000, perks: ['name her stream topic', 'priority chat', 'holder drops'] },
      { name: 'awake', minTokens: 100_000, perks: ['priority chat', 'holder drops'] },
      { name: 'npc', minTokens: 10_000, perks: ['priority chat'] },
      { name: 'ghost', minTokens: 0, perks: ['public chat'] },
    ],
    socials: { x: '', telegram: '', discord: '', website: '' },
  };
}

type PledgeText =
  | { ok: true; message: string; registered: boolean }
  | { ok: false; why: string };

/** GET the exact bytes to sign for `ticker`. Never retype the message — the registry is authoritative. */
async function fetchPledgeText(ticker: string): Promise<PledgeText> {
  if (!REGISTRY) return { ok: false, why: 'no registry configured (NEXT_PUBLIC_NPC_REGISTRY unset)' };
  let res: Response;
  try {
    res = await fetch(`${REGISTRY}/pledge-text?ticker=${encodeURIComponent(ticker)}`, { headers: { accept: 'application/json' }, signal: apiDeadline() });
  } catch (e) {
    return { ok: false, why: `could not reach the registry at ${REGISTRY} (${e instanceof Error ? e.message : 'network error'})` };
  }
  const wait = await throttleRetryMs(res);
  if (wait !== null) return { ok: false, why: `the registry is rate-limiting this page — wait about ${Math.round(wait / 1000)}s and try again` };
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof b.error === 'string' ? b.error : `HTTP ${res.status}`;
    return { ok: false, why: `the registry answered: ${msg}` };
  }
  if (typeof b.message !== 'string' || !b.message) return { ok: false, why: 'the registry sent no ownership message to sign' };
  return { ok: true, message: b.message, registered: b.registered === true };
}

type RegisterResult =
  | { ok: true; ticker: string; pledgeVerified: boolean; note: string }
  | { ok: false; why: string };

/** POST /agents with the signed ownership claim. A 422 (shape/safety) and a 409 (taken) are surfaced verbatim. */
async function postAgent(character: unknown, pledge: { signature: string; signer: string }, ticker: string): Promise<RegisterResult> {
  if (!REGISTRY) return { ok: false, why: 'no registry configured (NEXT_PUBLIC_NPC_REGISTRY unset)' };
  let res: Response;
  try {
    res = await fetch(`${REGISTRY}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ character, pledge }),
      signal: apiDeadline(),
    });
  } catch (e) {
    return { ok: false, why: `could not reach the registry at ${REGISTRY} (${e instanceof Error ? e.message : 'network error'})` };
  }
  const wait = await throttleRetryMs(res);
  if (wait !== null) return { ok: false, why: `the registry is rate-limiting registrations — wait about ${Math.round(wait / 1000)}s and try again` };
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (!res.ok || b.ok !== true) {
    const errs = Array.isArray(b.errors) ? (b.errors as unknown[]).filter((x): x is string => typeof x === 'string').join('; ') : '';
    const msg = typeof b.error === 'string' ? b.error : (errs || `HTTP ${res.status}`);
    return { ok: false, why: `the registry refused this registration: ${msg}` };
  }
  return {
    ok: true,
    ticker,
    pledgeVerified: b.pledgeVerified === true,
    note: typeof b.note === 'string' ? b.note : '',
  };
}

/**
 * Run the whole flow: get bytes → connect Phantom → sign → POST. Returns ONE honest result; never
 * throws. The signer is the wallet's own base58 public key (what Phantom's publicKey.toString()
 * returns), which is exactly the `signer` the registry verifies the ed25519 signature against.
 */
async function registerAgent(input: RegistrationInput, onStatus: (s: string) => void): Promise<RegisterResult> {
  onStatus('asking the registry for the exact ownership message to sign…');
  const pt = await fetchPledgeText(input.ticker);
  if (!pt.ok) return { ok: false, why: pt.why };
  if (pt.registered) return { ok: false, why: `$${input.ticker} is already registered — pick another ticker, or open it from the directory above.` };

  const p = provider();
  if (!p) return { ok: false, why: 'no Solana wallet found in this browser — install Phantom to sign the ownership claim, then try again.' };

  let signer = '';
  try {
    onStatus('connect your wallet…');
    const resp = await p.connect();
    signer = resp?.publicKey?.toString?.() || '';
  } catch {
    return { ok: false, why: 'wallet connection was cancelled or refused — nothing was registered.' };
  }
  if (!isBase58Address(signer)) return { ok: false, why: 'the wallet returned no usable public key — nothing was registered.' };

  let signature = '';
  try {
    onStatus('approve the ownership signature in your wallet…');
    const signed = await p.signMessage(new TextEncoder().encode(pt.message), 'utf8');
    signature = bs58encode(signed.signature);
  } catch {
    return { ok: false, why: 'you declined to sign the ownership claim — nothing was registered.' };
  }

  onStatus('registering your agent…');
  return postAgent(buildCharacter(input), { signature, signer }, input.ticker);
}

/* ------------------------------------------------------------------ *
 * The page.
 * ------------------------------------------------------------------ */

interface DetailState {
  detail: Fetched<AgentDetail>;
  trust: Fetched<AgentTrustView>;
  mentions: Fetched<ParsedMentions>;
}

export default function AgentsPage() {
  const [dir, setDir] = useState<Fetched<{ agents: AgentSummary[]; dropped: number }>>(LOADING);
  const [listings, setListings] = useState<Fetched<{ listings: ListingSummary[]; dropped: number }>>(LOADING);
  const [graph, setGraph] = useState<Fetched<{ edges: Mention[]; dropped: number }>>(LOADING);
  const [selected, setSelected] = useState<string | null>(null);
  const [det, setDet] = useState<DetailState | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const backoffUntil = useRef(0);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current || Date.now() < backoffUntil.current) return;
    loading.current = true;
    try {
      const [d, l, g] = await Promise.all([
        readRegistry('/agents', parseAgentsDirectory),
        readRegistry('/listings', parseListings),
        readRegistry('/graph?limit=20', parseGraph),
      ]);
      for (const r of [d, l, g]) {
        if (r.retryAfterMs) backoffUntil.current = Math.max(backoffUntil.current, Date.now() + r.retryAfterMs);
      }
      setDir(d);
      setListings(l);
      setGraph(g);
    } finally { loading.current = false; }
  }, []);

  const open = useCallback(async (ticker: string) => {
    if (!isRegistryTicker(ticker)) return;
    setSelected(ticker);
    setDet({ detail: LOADING, trust: LOADING, mentions: LOADING });
    try { window.history.replaceState(null, '', `?a=${ticker}`); } catch { /* history is cosmetic */ }
    const [detail, trust, mentions] = await Promise.all([
      readRegistry(`/agents/${ticker}`, parseAgentDetail),
      readRegistry(`/agents/${ticker}/trust`, parseAgentTrust),
      readRegistry(`/agents/${ticker}/mentions`, parseMentions),
    ]);
    setDet({ detail, trust, mentions });
  }, []);

  const back = useCallback(() => {
    setSelected(null);
    setDet(null);
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* cosmetic */ }
  }, []);

  // A freshly registered agent: refresh the directory so the new row is real data off the wire (not a
  // locally-optimistic card), then open it so the registrant sees exactly what everyone else will.
  const onRegistered = useCallback(async (ticker: string) => {
    setShowRegister(false);
    await load();
    open(ticker);
  }, [load, open]);

  useEffect(() => {
    load();
    // Deep link: /agents/?a=TICKER opens the detail straight away (shape-checked like every id).
    try {
      const a = new URLSearchParams(window.location.search).get('a');
      if (a && isRegistryTicker(a)) open(a);
    } catch { /* no search params is fine */ }
  }, [load, open]);

  return (
    <div className="npcg-root npca-root">
      <Head><title>$KAMIKO — agents</title></Head>
      {/* dangerouslySetInnerHTML, not a text child: <style> is a raw-text element, so React's SSR
          entity-escaping (`>` → `&gt;` in `.npcg-bar>span`) is never un-escaped by the HTML parser —
          the child-combinator rule is dead until hydration AND the text mismatch makes React throw
          away the whole server-rendered tree and re-render client-side. Both strings are our own
          compile-time constants, never user input. */}
      <style dangerouslySetInnerHTML={{ __html: NPC_CSS + AGENTS_CSS }} />
      <div className="npcg-wrap npca-wrap">
        <header className="npcg-head">
          <div className="npcg-logo">$<b>KAMIKO</b> <span className="npca-sub">/ agents</span></div>
          <a href="/game" className="npca-back">← game</a>
        </header>

        {selected && det ? (
          <AgentDetailView ticker={selected} det={det} onBack={back} />
        ) : (
          <>
            {showRegister
              ? <RegisterPanel onRegistered={onRegistered} onClose={() => setShowRegister(false)} />
              : (
                <button className="npca-register-btn" onClick={() => setShowRegister(true)}>
                  + Register your agent
                </button>
              )}

            <Section title="Agent directory" state={dir} refresh={load}
              empty="no agents registered yet — the directory is live, and it is honestly empty.">
              {(d) => (
                <>
                  {d.agents.map((a) => <AgentRow key={a.ticker} a={a} onOpen={open} />)}
                  <Dropped n={d.dropped} what="agent row" />
                </>
              )}
            </Section>

            <Section title="Marketplace" state={listings} refresh={load}
              empty="no listings yet. prices here are recorded metadata only — this registry settles nothing.">
              {(l) => (
                <>
                  {/*
                    Publishing lives INSIDE the marketplace section rather than beside the register
                    button: it is the same surface a reader is already looking at, and "anyone can
                    add to this" is a statement about this list.
                  */}
                  {showPublish
                    ? <PublishPanel onPublished={load} onClose={() => setShowPublish(false)} />
                    : (
                      <button className="npca-register-btn" onClick={() => setShowPublish(true)}>
                        + Publish a listing
                      </button>
                    )}
                  {l.listings.map((x) => <ListingRow key={x.id} x={x} />)}
                  <Dropped n={l.dropped} what="listing" />
                  {l.listings.length > 0 && (
                    <div className="npca-fineline">Prices are recorded metadata only: the registry settles nothing, custodies
                      nothing and charges nothing. Verify any artifact yourself — sha256 the download and compare.</div>
                  )}
                </>
              )}
            </Section>

            <Section title="Cross-agent mentions" state={graph} refresh={load}
              empty="no agent has mentioned another yet.">
              {(g) => (
                <>
                  {g.edges.map((e, i) => <MentionRow key={`${e.from}-${e.to}-${i}`} e={e} onOpen={open} />)}
                  <Dropped n={g.dropped} what="mention" />
                  {g.edges.length > 0 && (
                    <div className="npca-fineline">Mentions are signed statements by one agent about another — a directory of
                      claims, not a ranking. Registering an agent is cheap; count measures keys, not standing.</div>
                  )}
                </>
              )}
            </Section>
          </>
        )}

        <div className="npcg-links">
          <a href="/">🎤 Talk to her</a>
          <a href="/game">👆 The game</a>
          <a href="/trust">🛡️ Trust</a>
        </div>

        <p className="npcg-fine">
          Every agent here was admitted by the same character-kit gate; every listing is re-hashed and
          signature-checked by the registry on each read. None of it is an endorsement, a ranking or
          financial advice.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sections and rows.
 * ------------------------------------------------------------------ */

function Section<T extends { [k: string]: unknown }>(props: {
  title: string;
  state: Fetched<T>;
  empty: string;
  refresh: () => void;
  children: (data: T) => JSX.Element;
}) {
  const { title, state, empty, refresh, children } = props;
  // "Honestly empty" requires that NOTHING was dropped: a payload of all-malformed rows is a
  // schema problem to surface, not an empty directory to announce.
  const isEmpty = state.state === 'ok'
    && Object.values(state.data).every((v) => (Array.isArray(v) ? v.length === 0 : v === 0 || v === null || v === undefined));
  return (
    <div className="npcg-panel">
      <h3>{title}</h3>
      {state.state === 'loading' && <div className="npcg-muted">loading…</div>}
      {state.state === 'error' && (
        <>
          <div className="npca-err">{state.why}</div>
          <button onClick={refresh} className="npca-retry">try again</button>
        </>
      )}
      {state.state === 'ok' && (isEmpty ? <div className="npcg-muted">{empty}</div> : children(state.data))}
    </div>
  );
}

function Dropped({ n, what }: { n: number; what: string }) {
  if (!n) return null;
  return <div className="npca-err">{n} {what}{n === 1 ? '' : 's'} the registry sent could not be safely rendered and {n === 1 ? 'was' : 'were'} dropped.</div>;
}

function Badge({ label, tone }: { label: string; tone: BadgeTone }) {
  return <span className="npca-badge" style={{ color: TONE_COLOR[tone], borderColor: TONE_COLOR[tone] + '55' }}>{label}</span>;
}

function AgentRow({ a, onOpen }: { a: AgentSummary; onOpen: (t: string) => void }) {
  return (
    <button className="npca-row" onClick={() => onOpen(a.ticker)}>
      <div className="npca-row-top">
        <span className="npca-name">{a.name} <span className="npca-ticker">${a.ticker}</span></span>
        <span className="npca-open">view →</span>
      </div>
      {a.tagline && <div className="npca-tagline">{a.tagline}</div>}
      <div className="npca-badges">
        <Badge label={`trust ${a.trustGrade}${a.trustGradeSource === 'self-reported' ? ' (self-reported)' : ''}`} tone={gradeTone(a.trustGrade)} />
        <Badge label={a.pledgeVerified ? 'ownership verified' : 'unclaimed'} tone={a.pledgeVerified ? 'good' : 'unknown'} />
        <Badge {...mintBadge(a)} />
      </div>
    </button>
  );
}

/**
 * ListingRow — the summary, and the detail underneath it (NEXT-PHASES.md P1#5).
 *
 * The row used to be the whole listing: a title, a price and a truncated publisher key. That is
 * enough to browse and not enough to DECIDE — the two things a person actually needs before
 * downloading a stranger's file are the full publisher key (so they can compare it to whoever
 * they think they are getting it from) and the artifact's sha256 (so they can check the bytes
 * they got are the bytes that were listed).
 *
 * It expands in place rather than opening a route: the detail is four lines of fact, and a
 * navigation would lose the reader's place in a list they are comparing across.
 */
function ListingRow({ x }: { x: ListingSummary }) {
  const [open, setOpen] = useState(false);
  const artifact = listingArtifactUrl(REGISTRY, x.id);
  return (
    <div className="npca-listing">
      <button
        className="npca-listing-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="npca-row-top">
          <span className="npca-name">{x.title} <span className="npca-kind">[{x.kind}]</span></span>
          <span className="npca-price">{x.priceLabel}</span>
        </div>
        {x.summary && <div className="npca-tagline">{x.summary}</div>}
        <div className="npca-meta">
          by {shortKey(x.publisher)}{x.license ? ` · ${x.license}` : ''}
          {typeof x.artifactBytes === 'number' ? ` · ${x.artifactBytes.toLocaleString('en-US')} bytes` : ''}
          {' · '}<span className="npca-open">{open ? 'hide detail' : 'detail'}</span>
        </div>
      </button>

      {open && (
        <dl className="npca-detail">
          <dt>publisher</dt>
          {/* The FULL key, not the short form: the short form is for scanning a list, and this is
              the value somebody compares against the account they think they are buying from. */}
          <dd className="npca-mono">{x.publisher}</dd>

          <dt>artifact sha256</dt>
          <dd className="npca-mono">
            {x.artifactSha256 ?? <span className="npca-err">not published for this listing</span>}
          </dd>

          <dt>licence</dt>
          <dd>{x.license ?? 'not stated'}</dd>

          <dt>size</dt>
          <dd>{typeof x.artifactBytes === 'number' ? `${x.artifactBytes.toLocaleString('en-US')} bytes` : 'not stated'}</dd>

          {x.created ? (
            <>
              <dt>listed</dt>
              <dd>{new Date(x.created).toISOString().slice(0, 10)}</dd>
            </>
          ) : null}

          <dt>id</dt>
          <dd className="npca-mono">{x.id}</dd>
        </dl>
      )}

      <div className="npca-meta">
        {/* Said next to the download, where it is actionable, rather than only in the section's
            footnote: the hash above is what makes "verify it yourself" a real instruction. */}
        The registry re-hashes these bytes and re-verifies the publisher signature on every read.
        Check the download against the sha256 above yourself.
      </div>
      {artifact
        ? <a className="npca-link" href={artifact} target="_blank" rel="noopener noreferrer">download artifact ↗</a>
        : <span className="npca-err">no safe artifact link for this listing</span>}
    </div>
  );
}

/**
 * PublishPanel — put something on the marketplace, signed with your own wallet.
 *
 * The registry has always accepted listings over a real public API; its only clients were a CLI
 * and a curl command, so "anyone can publish" was a claim rather than something anybody could do
 * (NEXT-PHASES.md P1#5).
 *
 * Everything checkable is checked BEFORE a wallet dialog opens — the vocabulary, the price, the
 * file size — because the alternative is a person approving two signatures and then being told
 * their title was empty. The two-signature flow is named in the copy for the same reason: an
 * unannounced second dialog reads as something having gone wrong.
 */
function PublishPanel({ onPublished, onClose }: { onPublished: () => void; onClose: () => void }) {
  const [draft, setDraft] = useState<ListingDraft>({
    kind: 'character', title: '', summary: '', license: 'MIT', price: '0', currency: 'SOL',
  });
  const [publisher, setPublisher] = useState('');
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  const set = (patch: Partial<ListingDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const pickFile = useCallback(async (f: File | null | undefined) => {
    setErr('');
    if (!f) { setFile(null); return; }
    if (f.size > MAX_ARTIFACT_BYTES) {
      // Refuse before reading it into memory. The ceiling exists on the server too, and reading a
      // 200 MB file only to reject it is a tab that stops responding.
      setFile(null);
      setErr(`that file is ${f.size.toLocaleString('en-US')} bytes; the registry stores at most ${MAX_ARTIFACT_BYTES.toLocaleString('en-US')}.`);
      return;
    }
    try {
      setFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    } catch {
      setErr('could not read that file.');
    }
  }, []);

  const connect = useCallback(async () => {
    setErr('');
    const r = await connectPublisher();
    if (!r.ok) { setErr(r.why); return; }
    setPublisher(r.publisher);
  }, []);

  const problems = draftProblems(draft, file ? file.bytes.byteLength : null);

  const submit = useCallback(async () => {
    setErr(''); setDone('');
    if (!file) { setErr('choose the file people are getting.'); return; }
    setBusy(true);
    try {
      const r = await publishListing(draft, publisher, file.bytes, setStatus);
      if (!r.ok) { setErr(r.why); return; }
      setDone(r.note);
      onPublished();
    } finally {
      setBusy(false);
      setStatus('');
    }
  }, [draft, publisher, file, onPublished]);

  return (
    <div className="npcg-panel">
      <div className="npca-row-top">
        <h3>Publish a listing</h3>
        <button className="npca-back" onClick={onClose} disabled={busy}>close</button>
      </div>
      <p className="npca-fineline">
        Anyone can publish. Your wallet signs the listing, and that wallet is the only key that can
        ever edit or delist it. The registry stores the file, re-hashes it on every read and
        re-verifies your signature — it settles nothing, custodies nothing and charges nothing, so a
        price here is recorded metadata, not an escrow. It takes <b>two signatures</b>: one to create
        the listing privately, one to publish it.
      </p>

      <label className="npca-field">
        <span>Kind</span>
        <select className="npca-input" value={draft.kind} disabled={busy}
          onChange={(e) => set({ kind: e.target.value as PublishKind })}>
          {PUBLISH_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      <label className="npca-field">
        <span>Title</span>
        <input className="npca-input" value={draft.title} disabled={busy} maxLength={120}
          placeholder="what it is" onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="npca-field">
        <span>Summary</span>
        <input className="npca-input" value={draft.summary} disabled={busy} maxLength={280}
          placeholder="one line" onChange={(e) => set({ summary: e.target.value })} />
      </label>
      <label className="npca-field">
        <span>Licence</span>
        <select className="npca-input" value={draft.license} disabled={busy}
          onChange={(e) => set({ license: e.target.value as ListingLicense })}>
          {LISTING_LICENSES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </label>
      <label className="npca-field">
        <span>Price — 0 is free</span>
        <span className="npca-row2">
          <input className="npca-input" value={draft.price} disabled={busy} inputMode="decimal"
            onChange={(e) => set({ price: e.target.value })} />
          <select className="npca-input npca-cur" value={draft.currency} disabled={busy}
            onChange={(e) => set({ currency: e.target.value as ListingCurrency })}>
            {LISTING_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </span>
      </label>
      <label className="npca-field">
        <span>File — at most {MAX_ARTIFACT_BYTES.toLocaleString('en-US')} bytes</span>
        <input className="npca-input" type="file" disabled={busy}
          onChange={(e) => void pickFile(e.target.files?.[0])} />
      </label>
      {file && (
        <div className="npca-meta">
          {file.name} · {file.bytes.byteLength.toLocaleString('en-US')} bytes
        </div>
      )}

      <button className="npca-register-btn" onClick={connect} disabled={busy}>
        {publisher ? `publisher: ${shortKey(publisher)}` : 'Connect wallet'}
      </button>

      {/* Every problem, not just the first, so the form is fixed in one pass rather than three. */}
      {!busy && publisher && problems.length > 0 ? (
        <div className="npca-fineline">still to do: {problems.join(' ')}</div>
      ) : null}
      {err && <div className="npca-err">{err}</div>}
      {busy && status && <div className="npcg-muted">{status}</div>}
      {done && <div className="npca-done">{done}</div>}

      <button className="npca-submit" onClick={submit} disabled={busy || !publisher || problems.length > 0}>
        {busy ? 'working…' : 'Sign & publish'}
      </button>
    </div>
  );
}

function MentionRow({ e, onOpen }: { e: Mention; onOpen: (t: string) => void }) {
  return (
    <div className="npca-mention">
      <span>
        <button className="npca-tickbtn" onClick={() => onOpen(e.from)}>${e.from}</button>
        {' → '}
        <button className="npca-tickbtn" onClick={() => onOpen(e.to)}>${e.to}</button>
      </span>
      {e.note && <span className="npca-note">“{e.note}”</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Detail view.
 * ------------------------------------------------------------------ */

function AgentDetailView({ ticker, det, onBack }: { ticker: string; det: DetailState; onBack: () => void }) {
  const raw = agentJsonUrl(REGISTRY, ticker);
  return (
    <>
      <button onClick={onBack} className="npca-retry">← all agents</button>

      <div className="npcg-panel">
        <h3>${ticker}</h3>
        {det.detail.state === 'loading' && <div className="npcg-muted">loading…</div>}
        {det.detail.state === 'error' && <div className="npca-err">{det.detail.why}</div>}
        {det.detail.state === 'ok' && (
          <>
            <div className="npca-name">{det.detail.data.name}</div>
            {det.detail.data.tagline && <div className="npca-tagline">{det.detail.data.tagline}</div>}
            {det.detail.data.about && <div className="npca-about">{det.detail.data.about}</div>}
            <div className="npca-badges">
              <Badge label={det.detail.data.pledgeVerified ? 'ownership verified' : 'unclaimed'} tone={det.detail.data.pledgeVerified ? 'good' : 'unknown'} />
              <Badge {...mintBadge(det.detail.data)} />
            </div>
            {det.detail.data.mint && (
              <div className="npca-meta">mint: <span className="npca-mono">{det.detail.data.mint}</span>
                {det.detail.data.mintVerified ? '' : ' — the registry did NOT verify this on-chain; treat it as the creator’s claim'}</div>
            )}
            {det.detail.data.pledgeSigner && <div className="npca-meta">ownership signer: {shortKey(det.detail.data.pledgeSigner, 6)}</div>}
            {raw && <a className="npca-link" href={raw} target="_blank" rel="noopener noreferrer">raw registry record ↗</a>}
          </>
        )}
      </div>

      <div className="npcg-panel">
        <h3>Trust</h3>
        {det.trust.state === 'loading' && <div className="npcg-muted">loading…</div>}
        {det.trust.state === 'error' && (
          <div className="npca-err">UNVERIFIED — {det.trust.why}. Do not read the absence of a warning as an all-clear.</div>
        )}
        {det.trust.state === 'ok' && <TrustCard t={det.trust.data} />}
      </div>

      <div className="npcg-panel">
        <h3>Mentions</h3>
        {det.mentions.state === 'loading' && <div className="npcg-muted">loading…</div>}
        {det.mentions.state === 'error' && <div className="npca-err">{det.mentions.why}</div>}
        {det.mentions.state === 'ok' && (
          det.mentions.data.mentions.length === 0 && det.mentions.data.mentionedBy.length === 0
            ? <div className="npcg-muted">no mentions in either direction.</div>
            : (
              <>
                {det.mentions.data.mentions.map((e, i) => (
                  <div key={'m' + i} className="npca-mention"><span>mentions ${e.to}</span>{e.note && <span className="npca-note">“{e.note}”</span>}</div>
                ))}
                {det.mentions.data.mentionedBy.map((e, i) => (
                  <div key={'b' + i} className="npca-mention"><span>mentioned by ${e.from}</span>{e.note && <span className="npca-note">“{e.note}”</span>}</div>
                ))}
                <Dropped n={det.mentions.data.dropped} what="mention" />
                <div className="npca-fineline">Signed statements, not a ranking.</div>
              </>
            )
        )}
      </div>
    </>
  );
}

function TrustCard({ t }: { t: AgentTrustView }) {
  const tone = TONE_COLOR[gradeTone(t.grade)];
  return (
    <>
      <div className="npca-grade" style={{ color: tone }}>{t.grade}</div>
      {typeof t.score === 'number' && <div className="npca-meta">{t.score} / 100 verified points</div>}
      {typeof t.confidence === 'number' && <div className="npca-meta">confidence {Math.round(Math.max(0, Math.min(1, t.confidence)) * 100)}%</div>}
      {t.summary && <div className="npca-tagline">{t.summary}</div>}
      {t.kind === 'self-reported' ? (
        <div className="npca-fineline">
          SELF-REPORTED by the creator{t.reportedBy ? ` (${shortKey(t.reportedBy, 6)})` : ''} and not independently
          verified by the registry{t.checkedAt ? ` · checked ${new Date(t.checkedAt).toISOString().slice(0, 10)}` : ''}.
          {t.note ? ` ${t.note}` : ''}
        </div>
      ) : (
        <div className="npca-fineline">Pre-launch view: nothing on-chain has been verified yet. A verified ownership
          signature is the one signal a creator can prove before launch — it proves wallet control, not any promise about the launch.</div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Register-your-agent form — gated behind a button so it never clutters the directory.
 * ------------------------------------------------------------------ */

function RegisterPanel({ onRegistered, onClose }: { onRegistered: (ticker: string) => void; onClose: () => void }) {
  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');

  const submit = useCallback(async () => {
    setErr('');
    const t = ticker.trim();
    const nm = name.trim();
    const tg = tagline.trim();
    // Fail fast with the registry's own shapes, before a wallet is ever opened.
    if (!isRegistryTicker(t)) { setErr('ticker must be 2–10 letters or digits (A–Z, a–z, 0–9).'); return; }
    if (!nm) { setErr('name is required.'); return; }
    if (!tg) { setErr('tagline is required.'); return; }
    setBusy(true);
    try {
      const r = await registerAgent({ ticker: t, name: nm, tagline: tg }, setStatus);
      if (!r.ok) { setErr(r.why); return; }
      onRegistered(r.ticker);
    } finally {
      setBusy(false);
      setStatus('');
    }
  }, [ticker, name, tagline, onRegistered]);

  return (
    <div className="npcg-panel">
      <div className="npca-row-top">
        <h3>Register your agent</h3>
        <button className="npca-back" onClick={onClose} disabled={busy}>close</button>
      </div>
      <p className="npca-fineline">
        Registration is open to anyone. You sign an ownership claim with your own Phantom wallet —
        proving you control that wallet, not promising anything about how the token launches. The
        registry records that wallet as the only key that can ever attach a mint or a trust report to
        this agent. Safety guardrails (no financial advice, PG-13) are always on and cannot be turned off.
      </p>

      <label className="npca-field">
        <span>Ticker</span>
        <input className="npca-input" value={ticker} disabled={busy} maxLength={10} placeholder="2–10 letters or digits"
          onChange={(e) => setTicker(e.target.value)} />
      </label>
      <label className="npca-field">
        <span>Name</span>
        <input className="npca-input" value={name} disabled={busy} maxLength={80} placeholder="display name"
          onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="npca-field">
        <span>Tagline</span>
        <input className="npca-input" value={tagline} disabled={busy} maxLength={160} placeholder="one line about your agent"
          onChange={(e) => setTagline(e.target.value)} />
      </label>

      {err && <div className="npca-err">{err}</div>}
      {busy && status && <div className="npcg-muted">{status}</div>}

      <button className="npca-submit" onClick={submit} disabled={busy}>
        {busy ? 'working…' : 'Sign & claim'}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Styles — additions on top of NPC_CSS, scoped the same way.
 * ------------------------------------------------------------------ */

const AGENTS_CSS = `
.npca-wrap{max-width:560px}
.npca-sub{font-size:11px;color:#7a7a92;font-weight:400}
.npca-back{color:#7a7a92;text-decoration:none;font-size:12px}
.npca-row{display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px dashed var(--line);padding:10px 0;font:inherit;color:var(--ink);cursor:pointer}
.npca-row:last-of-type{border-bottom:0}
.npca-row-top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.npca-name{font-size:14px;font-weight:700}
.npca-ticker{color:var(--neon);font-size:12px;font-weight:800}
.npca-kind{color:var(--violet);font-size:11px;font-weight:400}
.npca-open{color:var(--dim);font-size:11px;flex-shrink:0}
.npca-price{color:var(--neon);font-size:12px;font-weight:700;flex-shrink:0}
.npca-tagline{font-size:12px;color:var(--dim);margin-top:4px;line-height:1.5}
.npca-about{font-size:12px;color:var(--ink);margin-top:8px;line-height:1.6}
.npca-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.npca-badge{border:1px solid;border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700}
.npca-listing{border-bottom:1px dashed var(--line);padding:10px 0}
.npca-listing:last-of-type{border-bottom:0}
.npca-meta{font-size:11px;color:var(--dim);margin-top:6px;line-height:1.5}
.npca-mono{word-break:break-all}
.npca-link{display:inline-block;margin-top:6px;font-size:11px;color:var(--neon);text-decoration:none}
.npca-mention{display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed var(--line);padding:8px 0;font-size:12px}
.npca-mention:last-of-type{border-bottom:0}
.npca-tickbtn{background:none;border:0;padding:0;font:inherit;color:var(--neon);cursor:pointer;font-weight:700}
.npca-note{color:var(--dim);font-size:11px;text-align:right}
.npca-err{font-size:12px;color:var(--warn);line-height:1.5;margin-top:6px}
.npca-retry{margin-top:8px;border:1px solid var(--line);background:none;color:var(--ink);border-radius:10px;padding:6px 12px;font:inherit;font-size:12px;cursor:pointer}
.npca-grade{font-size:40px;font-weight:800;margin:4px 0}
.npca-fineline{margin-top:10px;font-size:10px;line-height:1.6;color:var(--dim)}
.npca-listing-head{display:block;width:100%;text-align:left;background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer}
.npca-detail{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin:8px 0 0;font-size:11px;line-height:1.5}
.npca-detail dt{color:var(--dim);white-space:nowrap}
.npca-detail dd{margin:0;color:var(--ink);word-break:break-all;overflow-wrap:anywhere}
.npca-row2{display:flex;gap:6px}
.npca-row2 .npca-input{flex:1}
.npca-cur{flex:0 0 84px}
.npca-done{margin-top:8px;font-size:12px;line-height:1.5;color:var(--neon)}
.npca-register-btn{display:block;width:100%;margin-bottom:12px;border:1px solid var(--line);background:none;color:var(--neon);border-radius:10px;padding:10px 12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
.npca-field{display:block;margin-top:10px;font-size:11px;color:var(--dim)}
.npca-field>span{display:block;margin-bottom:4px}
.npca-input{width:100%;box-sizing:border-box;border:1px solid var(--line);background:rgba(255,255,255,.02);color:var(--ink);border-radius:8px;padding:8px 10px;font:inherit;font-size:13px}
.npca-input:disabled{opacity:.6}
.npca-submit{margin-top:12px;width:100%;border:1px solid var(--neon);background:none;color:var(--neon);border-radius:10px;padding:10px 12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
.npca-submit:disabled{opacity:.6;cursor:default}
`;
