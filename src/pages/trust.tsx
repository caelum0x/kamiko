/**
 * trust.tsx — the verification report a stranger reads before touching $KAMIKO, as an amica route.
 *
 * This is the money-safety surface, wired to OUR on-chain verifier: it GETs /trust from game-api
 * through the bridge proxy (NEXT_PUBLIC_NPC_API). Every rule is fail-closed, because being wrong here
 * tells someone a token is safe when we never checked:
 *   - NO OPTIMISTIC FIRST PAINT — it opens grey ("checking"), never a hopeful shape.
 *   - EVERY FAILURE IS ONE OUTCOME: UNVERIFIED. A network error, a non-200, unparseable JSON, a
 *     wrong schema and ok:false all land in the same grey state; a partial payload is never a score.
 *   - THE COLOUR COMES FROM THE API's GRADE, never computed here; an unrecognised grade stays grey.
 *   - `unknown` IS NOT A SOFT PASS.
 * React escapes text by default; the only hand-guard kept is `safeUrl`, so a javascript: URL from a
 * compromised API can never become a link.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { SeoHead } from '@/components/seoHead';

import { API, apiDeadline, throttleRetryMs } from '../npc/config.ts';

const TRUST_SCHEMA = 'npc.trust-report';

const safeUrl = (u: unknown): string | null => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
const num = (n: unknown, d = 2): string | null => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d }) : null);
const pct = (n: unknown): string => (typeof n === 'number' && isFinite(n) ? num(n, 2) + '%' : 'UNKNOWN');
const BAND: Record<string, string> = { A: '#00ffa3', B: '#00ffa3', C: '#ffb020', D: '#ffb020', F: '#ff2e63' };

/**
 * Signal rows that NARRATE THE DEVELOPER's own holdings are never shown to a holder. We have no
 * obligation to disclose developer holdings, and a "dev bag" row — even rendered as UNKNOWN — tells a
 * holder nothing verifiable and only invites speculation about developer buys/sells. The on-chain
 * SAFETY checks (mint & freeze authority, LP custody, holder concentration, third-party scanners, the
 * signed ownership claim) are untouched and still shown; only the developer-holdings narration is
 * suppressed. `creator_balance` is the scorer's developer-holdings signal (see
 * packages/onchain/trustscore.ts).
 */
const HIDDEN_SIGNAL_IDS = new Set<string>(['creator_balance']);

type Outcome = { ok: true; report: any } | { ok: false; reason: string };
function classifyTrust(status: number, body: any): Outcome {
  if (!body || typeof body !== 'object' || body.schema !== TRUST_SCHEMA) {
    return { ok: false, reason: `the verifier answered with something we do not recognise (HTTP ${status})` };
  }
  if (body.ok !== true) {
    const u = body.unavailable || {};
    return { ok: false, reason: u.detail || 'the verifier reported: ' + (u.reason || 'unavailable') };
  }
  return { ok: true, report: body };
}

export default function TrustPage() {
  const [report, setReport] = useState<any>(null);
  const [unverified, setUnverified] = useState<string | null>('checking on-chain…');
  /** Why the report on screen may not be current. '' when the last read was a real answer. */
  const [throttleNote, setThrottleNote] = useState('');
  /*
   * Both of these are refs, not state, and both were bugs as state.
   *
   * `loading` guarded re-entrancy, but the 120 s interval below is installed once with a `load`
   * captured on the first render — where `loading` is permanently false — so the guard could never
   * fire for the poll it was written for. A ref is read at call time, which is what a re-entrancy
   * guard has to be.
   *
   * `backoffUntil` is the brake a 429 sets, copied from game.tsx's shared brake for the same reason
   * it exists there: the client and the game page share one rate-limit bucket per address, so
   * answering a throttle by polling again on the normal schedule spends the budget on the request
   * that was already refused.
   */
  const loading = useRef(false);
  const backoffUntil = useRef(0);

  const load = useCallback(async () => {
    if (!API) { setUnverified('no verifier configured (NEXT_PUBLIC_NPC_API unset)'); return; }
    if (loading.current || Date.now() < backoffUntil.current) return;
    loading.current = true;
    try {
      const res = await fetch(API + '/trust', { headers: { accept: 'application/json' }, signal: apiDeadline() });
      /*
       * A THROTTLE IS NOT A VERDICT — the same rule game.tsx already documents having fixed on its
       * own /trust poll ("the funnel disowning its own mint because it polled too fast", game.tsx's
       * contract-CTA comment). GET /trust is rate-limited at burst 60 / 30 per minute and a 429 is
       * JSON, so the previous code parsed it happily, found `schema !== 'npc.trust-report'`, and
       * printed the grey UNVERIFIED card with "assume unverified, and check the mint yourself" —
       * about a token OUR OWN verifier had just passed. On a throttle we change nothing on screen,
       * note why, and stop asking until the server said we may.
       *
       * This page does its own fetch rather than going through `readJson` because a report the
       * verifier could not build arrives as a real body with HTTP 503 (services/game-api/trust.ts:
       * "A report we could not build is a 503, not a 200 with a sad payload"), and the
       * `unavailable.detail` in it is the most useful sentence on the page. `throttleRetryMs` is the
       * one piece of readJson this needs, so it is shared rather than copied.
       */
      const wait = await throttleRetryMs(res);
      if (wait !== null) {
        backoffUntil.current = Math.max(backoffUntil.current, Date.now() + wait);
        setThrottleNote(`the verifier is rate-limiting this page — this report is not being re-checked for about ${Math.round(wait / 1000)}s. nothing below has changed.`);
        return;
      }
      let body: any = null;
      try { body = await res.json(); } catch { body = null; }
      const out = classifyTrust(res.status, body);
      setThrottleNote('');
      if (out.ok) { setReport(out.report); setUnverified(null); }
      else { setReport(null); setUnverified(out.reason); }
    } catch (e: any) {
      setThrottleNote('');
      setReport(null);
      setUnverified(`could not reach the verifier at ${API} (${e?.message || 'network error'})`);
    } finally { loading.current = false; }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 120000); return () => clearInterval(id); }, [load]);

  const s = report?.score;
  const verdict = ['pass', 'warn', 'fail'].includes(report?.verdict) ? report.verdict : 'unknown';
  const VERDICT: Record<string, [string, string]> = {
    pass: ['VERIFIED', 'every section we check was read, and none failed'],
    warn: ['CONCERNS', 'we read everything and did not like some of it'],
    fail: ['FAILED', 'a check we can make came back bad'],
    unknown: ['UNVERIFIED', 'at least one check could not be completed — not an all-clear'],
  };
  const conf = typeof s?.confidence === 'number' && isFinite(s.confidence) ? Math.max(0, Math.min(1, s.confidence)) : 0;
  // Drop developer-holdings narration before it ever reaches a holder (see HIDDEN_SIGNAL_IDS). The
  // score itself is left exactly as the verifier computed it — only the row is hidden.
  const shownSignals: any[] = Array.isArray(s?.signals) ? s.signals.filter((x: any) => !HIDDEN_SIGNAL_IDS.has(x?.id)) : [];

  return (
    <div className="npct-root">
      <SeoHead
        title="Verify Kamiko — Project Trust and Token Checks"
        description="Review Kamiko's live project checks, verification status, token signals, and clear warnings before trusting any claimed mint or market data."
        path="/trust/"
      />
      {/* raw-text element — see agents.tsx: a text child is SSR entity-escaped (`>` → `&gt;`) and
          never un-escaped, breaking child-combinator rules pre-hydration and mismatching hydration. */}
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="npct-wrap">
        <header className="npct-head">
          <h1 className="npct-logo">Verify $<b>KAMIKO</b> <span>/ trust and token checks</span></h1>
          <a href="/" className="npct-back">← Kamiko</a>
        </header>

        <section className="npct-card" aria-labelledby="trust-page-about">
          <h2 id="trust-page-about">What this page verifies</h2>
          <div className="npct-dim">
            This page reports the project and token checks the live verifier could complete. Each signal
            keeps its own pass, warning, failure, or unknown state; missing data is not converted into a
            clean result. Use the direct evidence link when one is available, confirm any published mint
            on a block explorer, and check the report time before relying on changing market or holder
            data. This is a verification report, not a financial audit or a promise that a token is safe.
          </div>
        </section>

        {throttleNote ? <div className="npct-throttle">{throttleNote}</div> : null}

        {unverified ? (
          <div className="npct-card">
            <div className="npct-unv">UNVERIFIED</div>
            <div className="npct-dim">{unverified}</div>
            <div className="npct-dim">Nothing on this page has been checked. Do not read the absence of a warning as an
              all-clear — assume unverified, and check the mint yourself on a block explorer.</div>
            <button onClick={load} className="npct-btn">try again</button>
          </div>
        ) : (
          <>
            <div className="npct-card center">
              <div className="npct-verdict" style={{ color: verdict === 'pass' ? '#00ffa3' : verdict === 'warn' ? '#ffb020' : verdict === 'fail' ? '#ff2e63' : '#7a7a92' }}>
                {VERDICT[verdict][0]} <span className="npct-dim">· {VERDICT[verdict][1]}</span>
              </div>
              {!s ? (
                <>
                  <div className="npct-grade" style={{ color: '#7a7a92' }}>—</div>
                  <div className="npct-dim">no score published. Treat this token as unverified.</div>
                </>
              ) : (
                <>
                  <div className="npct-grade" style={{ color: BAND[s.grade] || '#7a7a92' }}>{s.grade || 'unrated'}</div>
                  <div className="npct-dim"><b style={{ color: '#e8e8f2' }}>{num(s.score, 0)}</b> / 100 verified points
                    {s.unknownCount ? <span style={{ color: '#ffb020' }}> · {s.unknownCount} signal{s.unknownCount === 1 ? '' : 's'} UNKNOWN</span> : null}</div>
                  <div className="npct-conf"><span>CONFIDENCE</span><span>{Math.round(conf * 100)}%</span></div>
                  <div className="npct-bar"><span style={{ width: conf * 100 + '%', background: conf < 0.5 ? '#7a7a92' : 'linear-gradient(90deg,#8b5cf6,#00ffa3)' }} /></div>
                  {s.summary ? <div className="npct-dim npct-left">{s.summary}</div> : null}
                  {Array.isArray(s.criticalFailures) && s.criticalFailures.length > 0 ? (
                    <div className="npct-crit"><b>CRITICAL:</b>{s.criticalFailures.map((f: any, i: number) => <div key={i}>{f.label} — {f.detail}</div>)}</div>
                  ) : null}
                </>
              )}
            </div>
            {shownSignals.length ? (
              <div className="npct-card">
                <h3>Signals ({shownSignals.length})</h3>
                {shownSignals.map((x: any, i: number) => (
                  <div key={i} className="npct-sig">
                    <div className="npct-sig-top"><span>{x.label || x.id}</span><span className={'npct-chip ' + (['pass', 'warn', 'fail'].includes(x.status) ? x.status : 'unknown')}>{(['pass', 'warn', 'fail'].includes(x.status) ? x.status : 'unknown').toUpperCase()}</span></div>
                    <div className="npct-dim">{x.detail}</div>
                    {safeUrl(x.link?.url) ? <a href={safeUrl(x.link.url)!} target="_blank" rel="noopener noreferrer">check it yourself →</a> : <span className="npct-warn">no direct link for this check</span>}
                  </div>
                ))}
              </div>
            ) : null}
            {report?.holders && (
              <div className="npct-card">
                <h3>Top holders {report.holders.complete ? '(full sweep)' : '(partial — lower bounds)'}</h3>
                <div className="npct-metrics">
                  {[['TOP 1', report.holders.top1Pct], ['TOP 5', report.holders.top5Pct], ['TOP 10', report.holders.top10Pct], ['TOP 20', report.holders.top20Pct]].map(([k, v]) => (
                    <div key={k as string} className="npct-metric"><div className="npct-dim">{k}</div><div style={{ color: typeof v === 'number' ? '#e8e8f2' : '#ffb020' }}>{pct(v)}</div></div>
                  ))}
                </div>
              </div>
            )}
            {typeof report?.checkedAt === 'number' && (
              <div className="npct-dim npct-center">last checked {new Date(report.checkedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC{report.stale ? ' · STALE: re-check failed' : ''}</div>
            )}
          </>
        )}

        <div className="npct-fine"><b style={{ color: '#e8e8f2' }}>NOT FINANCIAL ADVICE.</b> This is a verification report, not an
          audit and not a safety rating. A clean report does not stop $KAMIKO going to zero — most memecoins do; $KAMIKO is an
          experimental memecoin with no intrinsic value. Only risk what you can lose. NVDAX is a tokenized tracker, NOT NVIDIA
          stock — holders own no NVIDIA shares. Not affiliated with NVIDIA, Backed, Raydium or StonkFun beyond being launched on
          StonkFun. There is no official $KAMIKO contract until the mint is live and pinned.</div>
      </div>
    </div>
  );
}

const CSS = `
.npct-root{position:fixed;inset:0;overflow:auto;background:radial-gradient(900px 500px at 50% -5%,#15152c,#07070c 60%);color:#e8e8f2;font-family:ui-monospace,Menlo,monospace;z-index:50}
.npct-wrap{max-width:520px;margin:0 auto;padding:24px 16px 80px}
.npct-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px}
.npct-logo{font-size:20px;font-weight:800}.npct-logo b{color:#00ffa3}.npct-logo span{font-size:11px;color:#7a7a92;font-weight:400}
.npct-back{color:#7a7a92;text-decoration:none;font-size:12px}
.npct-card{border:1px solid #1c1c2e;background:#0e0e18;border-radius:16px;padding:16px;margin-top:12px}
.npct-card.center{text-align:center}
.npct-card h3{font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#7a7a92;margin:0 0 10px}
.npct-unv{font-size:18px;font-weight:800;color:#7a7a92}
.npct-verdict{font-size:11px;font-weight:800;letter-spacing:2px}
.npct-grade{font-size:48px;font-weight:800;margin:8px 0}
.npct-dim{font-size:12px;color:#7a7a92;line-height:1.5;margin-top:6px}.npct-left{text-align:left}.npct-center{text-align:center}
.npct-conf{display:flex;justify-content:space-between;font-size:10px;letter-spacing:2px;color:#7a7a92;margin:12px 0 4px}
.npct-bar{height:8px;border-radius:99px;background:#1c1c2e;overflow:hidden}.npct-bar>span{display:block;height:100%}
.npct-crit{margin-top:8px;text-align:left;font-size:12px;color:#ff2e63}
.npct-btn{margin-top:12px;border:1px solid #1c1c2e;background:none;color:#e8e8f2;border-radius:10px;padding:8px 14px;font:inherit;cursor:pointer}
.npct-sig{border-bottom:1px dashed #1c1c2e;padding:8px 0}.npct-sig:last-child{border:0}
.npct-sig-top{display:flex;justify-content:space-between;font-size:12px}
.npct-sig a{font-size:11px;color:#00ffa3;text-decoration:none}
.npct-chip{font-size:10px;font-weight:700}.npct-chip.pass{color:#00ffa3}.npct-chip.warn{color:#ffb020}.npct-chip.fail{color:#ff2e63}.npct-chip.unknown{color:#7a7a92}
.npct-warn{color:#ffb020;font-size:11px}
.npct-metrics{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px}
.npct-metric{border:1px solid #1c1c2e;border-radius:8px;padding:8px;text-align:center;font-size:13px;font-weight:700}
.npct-throttle{border:1px solid #3a3a1c;background:#171708;border-radius:12px;padding:10px 12px;margin-top:12px;font-size:11px;line-height:1.5;color:#ffb020}
.npct-fine{margin-top:20px;border:1px solid #1c1c2e;border-radius:12px;padding:12px;font-size:11px;line-height:1.6;color:#7a7a92}
`;
