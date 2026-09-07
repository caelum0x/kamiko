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

import { REGISTRY, apiDeadline, throttleRetryMs } from '../npc/config.ts';
import {
  agentJsonUrl, gradeTone, isRegistryTicker, listingArtifactUrl, mintBadge, parseAgentDetail,
  parseAgentTrust, parseAgentsDirectory, parseGraph, parseListings, parseMentions, shortKey,
  type AgentDetail, type AgentSummary, type AgentTrustView, type BadgeTone, type ListingSummary,
  type Mention, type ParsedMentions,
} from '../npc/registry.ts';
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
        <Badge label={a.pledgeVerified ? 'pledge signed' : 'no pledge'} tone={a.pledgeVerified ? 'good' : 'unknown'} />
        <Badge {...mintBadge(a)} />
      </div>
    </button>
  );
}

function ListingRow({ x }: { x: ListingSummary }) {
  const artifact = listingArtifactUrl(REGISTRY, x.id);
  return (
    <div className="npca-listing">
      <div className="npca-row-top">
        <span className="npca-name">{x.title} <span className="npca-kind">[{x.kind}]</span></span>
        <span className="npca-price">{x.priceLabel}</span>
      </div>
      {x.summary && <div className="npca-tagline">{x.summary}</div>}
      <div className="npca-meta">
        by {shortKey(x.publisher)}{x.license ? ` · ${x.license}` : ''}
        {typeof x.artifactBytes === 'number' ? ` · ${x.artifactBytes.toLocaleString('en-US')} bytes` : ''}
        {' · sha256-verified on every read'}
      </div>
      {artifact
        ? <a className="npca-link" href={artifact} target="_blank" rel="noopener noreferrer">download artifact ↗</a>
        : <span className="npca-err">no safe artifact link for this listing</span>}
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
              <Badge label={det.detail.data.pledgeVerified ? 'pledge signed' : 'no pledge'} tone={det.detail.data.pledgeVerified ? 'good' : 'unknown'} />
              <Badge {...mintBadge(det.detail.data)} />
            </div>
            {det.detail.data.mint && (
              <div className="npca-meta">mint: <span className="npca-mono">{det.detail.data.mint}</span>
                {det.detail.data.mintVerified ? '' : ' — the registry did NOT verify this on-chain; treat it as the creator’s claim'}</div>
            )}
            {det.detail.data.pledgeSigner && <div className="npca-meta">pledge signer: {shortKey(det.detail.data.pledgeSigner, 6)}</div>}
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
        <div className="npca-fineline">Pre-launch view: nothing on-chain has been verified yet. A verified fair-launch
          pledge is the one signal a creator can prove before launch.</div>
      )}
    </>
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
`;
