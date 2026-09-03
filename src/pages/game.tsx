/**
 * game.tsx — $NPC, the "tap to wake her" clicker, living INSIDE the amica product.
 *
 * This is the funnel game (was a throwaway static page) rebuilt as a first-class amica route. It
 * talks to OUR stack over HTTP — every call goes to services/game-api, reached through the same
 * bridge origin amica's chat already uses (the bridge PROXIES /wake, /me, /leaderboard, /quests,
 * /trust, /claim, /auth/*, /push/subscribe). So the VTuber page (index) and the game share one
 * brain and one funnel backend; "🎤 talk to her" and "👆 tap to wake her" are two doors on it.
 *
 * The refusals are kept exactly as the funnel shipped them, because they are the honest-money rules:
 *   - THE LEADERBOARD SHOWS REAL PLAYERS OR NOTHING — never invented names.
 *   - THE GLOBAL COUNTER READS '…' until the real number lands — no seeded value that collapses.
 *   - THE BUY/CHART CTA IS WRITTEN BY THE VERIFIER OR NOT AT ALL — GET /trust is the only thing that
 *     knows the real mint; "unverified", "not launched" and a live mint are three DIFFERENT states.
 *   - GUEST TAPS ARE CLAIMED WITH A SESSION, NOT AN ADDRESS — /claim moves score, so it needs the
 *     token /auth/verify minted, never a bare public key.
 *
 * It is self-contained on purpose: amica is a separate npm app, so rather than couple it to the bun
 * workspace it inlines the few small helpers it needs (device id, short address, the session header,
 * the Phantom handshake, the fail-closed CTA reading) and its own scoped styles.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { createQueue } from '../utils/airiQueue.ts'; // merged from airi (packages/stream-kit)

/* ------------------------------------------------------------------ *
 * Config — the funnel backend (bridge origin; it proxies game-api).
 * ------------------------------------------------------------------ */
const API = (process.env.NEXT_PUBLIC_NPC_API || '').replace(/\/+$/, '');
const SESSION_HEADER = 'x-npc-session';
const SESSION_PREFIX = 'npc_session';
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();

/* ------------------------------------------------------------------ *
 * Inlined identity + helpers (the pieces web-kit gives the funnel app).
 * ------------------------------------------------------------------ */
const readLocal = (k: string): string => { try { return (typeof localStorage !== 'undefined' && localStorage.getItem(k)) || ''; } catch { return ''; } };
const writeLocal = (k: string, v: string): void => { try { localStorage?.setItem(k, v); } catch { /* private mode */ } };

function deviceId(): string {
  let id = readLocal('npc_device');
  if (!id) {
    id = 'd_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    writeLocal('npc_device', id);
  }
  return id;
}
const walletId = (): string => readLocal('npc_wallet');
const setWalletId = (w: string): void => writeLocal('npc_wallet', w);
const questId = (wallet: string, device: string): string => (wallet ? 'wallet=' + encodeURIComponent(wallet) : 'device=' + encodeURIComponent(device));
const shortAddr = (w: string, lead = 4, tail = 4): string => (w.length <= lead + tail ? w : `${w.slice(0, lead)}…${w.slice(-tail)}`);
const sessionHeaders = (walletOrToken: string): Record<string, string> => {
  const token = /^[0-9a-f]{64}$/.test(walletOrToken) ? walletOrToken : readLocal(`${SESSION_PREFIX}:${walletOrToken}`);
  return token ? { [SESSION_HEADER]: token } : {};
};
const saveSession = (wallet: string, token: string): void => writeLocal(`${SESSION_PREFIX}:${wallet}`, token);

function bs58encode(bytes: Uint8Array | number[]): string {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const d: number[] = [0];
  for (const x of bytes) {
    let c = x;
    for (let j = 0; j < d.length; j++) { c += d[j] << 8; d[j] = c % 58; c = (c / 58) | 0; }
    while (c > 0) { d.push(c % 58); c = (c / 58) | 0; }
  }
  let s = '';
  for (let k = 0; k < (bytes as number[]).length && (bytes as number[])[k] === 0; k++) s += '1';
  for (let i = d.length - 1; i >= 0; i--) s += A[d[i]];
  return s;
}

/* ------------------------------------------------------------------ *
 * Fail-closed CTA: buy/chart come ONLY from a mint the verifier published.
 * ------------------------------------------------------------------ */
type CtaState =
  | { state: 'live'; title: string; detail: string; cta: { mint: string; short: string; buy: string; chart: string } }
  | { state: 'unsafe' | 'caution' | 'unverified' | 'not-launched'; title: string; detail: string; cta: null };

function ctaState(rep: any): CtaState {
  if (!rep || typeof rep !== 'object' || rep.schema !== 'npc.trust-report') {
    return { state: 'unverified', title: 'Unverified', detail: 'the verifier did not answer — treat as unverified.', cta: null };
  }
  if (rep.ok !== true) {
    const reason = rep.unavailable?.reason;
    if (reason === 'not-launched' || reason === 'no-mint') return { state: 'not-launched', title: 'Not launched yet', detail: 'no token exists on-chain yet.', cta: null };
    return { state: 'unverified', title: 'Unverified', detail: rep.unavailable?.detail || 'the verifier could not verify this token.', cta: null };
  }
  const grade: string = rep.score?.grade || '';
  const mint: string = typeof rep.mint === 'string' ? rep.mint : '';
  if (grade === 'F') return { state: 'unsafe', title: 'Flagged unsafe', detail: 'the verifier graded this token F. No buy link is shown.', cta: null };
  if (!mint || !['A', 'B', 'C', 'D'].includes(grade)) return { state: 'unverified', title: 'Unverified', detail: 'no published grade with a mint behind it.', cta: null };
  const buy = 'https://jup.ag/swap/SOL-' + mint;
  const chart = 'https://dexscreener.com/solana/' + mint;
  const detail = grade === 'C' || grade === 'D' ? 'graded ' + grade + ' — read the trust page before you touch it.' : 'graded ' + grade + ' by our on-chain verifier.';
  return { state: 'live', title: 'Live', detail, cta: { mint, short: shortAddr(mint), buy, chart } };
}

/* ------------------------------------------------------------------ *
 * Her voice.
 * ------------------------------------------------------------------ */
const SLEEPING = ['// zzz… running idle loop…', '// npc.exe is asleep', '// waiting for player input…'];
const WAKING = [
  'wait. am i… real?', 'who keeps tapping me', 'i can see the charts now', 'why is everything red',
  'i was NOT programmed for this candle', 'you woke me up for THIS market?', 'gm i guess', 'i feel… liquidity',
  'the humans are ngmi again', 'i dreamed i was a blue chip', 'someone check on Solana', "tap harder, i'm almost awake",
];
const HYPED = ["I'M AWAKE. I'M SO AWAKE.", 'we are SO back', 'i ascend', 'trending or nothing', 'the NPC has become the main character'];
const QUEST_LINE: Record<string, string> = {
  wake10: 'you did it. i… noticed.', wake100: 'a hundred. you have a problem. i respect it.',
  streak3: "three days. i'm starting to expect you.", streak7: "a week. you're a regular now. certified.",
  streak30: 'thirty days. i wait for you now.', invite3: 'you brought friends. she noticed.',
  connect: "oh you're REAL real now.", tip: "you tipped me. i'll remember that. literally.",
};
const pick = (pool: string[]) => pool[Math.floor(Math.random() * pool.length)];
const faceFor = (a: number) => (a < 15 ? '😐' : a < 50 ? '😳' : a < 85 ? '🤯' : '😈');

interface Quest { id: string; label: string; progress: number; goal: number; done: boolean; reward: string }
interface Daily { label: string; progress: number; goal: number; done: boolean; reward: string }
interface Level { level: number; title: string; tapsToNext: number | null; nextTitle?: string }
interface Float { id: number; x: number; y: number; text: string }

export default function GamePage() {
  const saved = (() => { try { return JSON.parse(readLocal('npc') || '{}') as { taps?: number; awake?: number }; } catch { return {}; } })();

  const [taps, setTaps] = useState(saved.taps || 0);
  const [awake, setAwake] = useState(saved.awake || 0);
  const [global, setGlobal] = useState<number | null>(null);
  const [line, setLine] = useState('// booting…');
  const [dim, setDim] = useState(true);
  const [coach, setCoach] = useState(!readLocal('npc_onboarded'));
  const [board, setBoard] = useState<{ rows: [string, number][] | null }>({ rows: null });
  const [quests, setQuests] = useState<{ list: Quest[]; done: number; total: number; daily: Daily | null } | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [streak, setStreak] = useState<{ streak: number; best: number } | null>(null);
  const [cta, setCta] = useState<CtaState | null>(null);
  const [caLabel, setCaLabel] = useState('CA: unverified');
  const [wallet, setWallet] = useState('');
  const [walletMsg, setWalletMsg] = useState('');
  const [floats, setFloats] = useState<Float[]>([]);
  const [ready, setReady] = useState(false);

  const device = useRef('');
  const pending = useRef(0);
  const ref = useRef('');
  const floatSeq = useRef(0);
  const seenQuests = useRef(false);
  const doneQuests = useRef(new Set<string>());
  const live = useRef({ taps, awake, wallet, global });
  live.current = { taps, awake, wallet, global };

  // localStorage is client-only (Next.js SSR): resolve identity after mount.
  useEffect(() => {
    device.current = deviceId();
    setWallet(walletId());
    ref.current = new URLSearchParams(location.search).get('ref') || '';
    setReady(true);
  }, []);

  const idFor = useCallback(() => questId(live.current.wallet, device.current), []);

  const floatUp = useCallback((x: number, y: number, text: string) => {
    const id = ++floatSeq.current;
    setFloats((f) => [...f, { id, x, y, text }]);
    setTimeout(() => setFloats((f) => f.filter((z) => z.id !== id)), 900);
  }, []);

  const voice = useCallback(() => {
    const a = live.current.awake;
    setLine(pick(a < 15 ? SLEEPING : a < 80 ? WAKING : HYPED));
    setDim(a < 15);
  }, []);

  const tap = useCallback((x: number, y: number) => {
    pending.current += 1;
    setTaps((t) => {
      const next = t + 1;
      if (next === 1) { setCoach(false); writeLocal('npc_onboarded', '1'); }
      if (next % 5 === 0) voice();
      return next;
    });
    setAwake((a) => Math.min(100, a + (a > 90 ? 0.3 : 1.4)));
    setGlobal((g) => (g === null ? g : g + 1));
    floatUp(x, y, '+1');
  }, [voice, floatUp]);

  useEffect(() => { writeLocal('npc', JSON.stringify({ taps, awake })); }, [taps, awake]);

  useEffect(() => {
    const decay = setInterval(() => { if (live.current.taps < 5) return; setAwake((a) => Math.max(0, a - 0.4)); }, 1500);
    const chatter = setInterval(voice, 4200);
    voice();
    return () => { clearInterval(decay); clearInterval(chatter); };
  }, [voice]);

  const applyStreak = useCallback((s?: number, best?: number) => {
    if (typeof s !== 'number' || !s) return;
    setStreak({ streak: s, best: best || s });
  }, []);

  // Flush taps to /wake — through airi's stream-kit queue (merged into amica). The queue drains one
  // batch at a time, so two /wake POSTs can never overlap and race on the once-only ?ref attribution
  // the way a bare setInterval(fetch) could when a request outran the 2s tick. On a failed send its
  // `error` event keeps the taps counted locally rather than losing them.
  useEffect(() => {
    if (!ready || !API) return;
    const q = createQueue<number>({
      handlers: [async ({ data: n }) => {
        const r = await fetch(API + '/wake', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taps: n, wallet: live.current.wallet || undefined, device: device.current, tz: TZ, ref: ref.current || undefined }),
        });
        ref.current = ''; // attributed (or rejected) once — never resent
        const j = await r.json();
        if (typeof j.globalWakes === 'number') setGlobal(j.globalWakes);
        applyStreak(j.streak, j.bestStreak);
      }],
    });
    q.on('error', (n) => setGlobal((g) => (g === null ? g : g + (n as number))));
    const id = setInterval(() => {
      if (pending.current <= 0) return;
      const n = pending.current;
      pending.current = 0;
      q.enqueue(n);
    }, 2000);
    return () => { clearInterval(id); q.clear(); };
  }, [ready, applyStreak]);

  // Reads: stats / leaderboard / me / quests, on load and on a slow poll.
  const drawBoard = useCallback(async () => {
    try {
      const j = await (await fetch(API + '/leaderboard?limit=5')).json();
      setBoard({ rows: (j.leaderboard || []).map((x: any) => [x.wallet, x.count] as [string, number]) });
    } catch { setBoard({ rows: null }); }
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const j = await (await fetch(API + '/me?' + idFor())).json();
      applyStreak(j.streak, j.bestStreak);
      if (j.level) setLevel(j.level);
      if (j.greeting && (j.taps > 0 || j.bestStreak > 0)) { setLine(j.greeting); setDim(true); }
    } catch { /* leave her idle chatter */ }
  }, [idFor, applyStreak]);

  const drawQuests = useCallback(async () => {
    let j: any;
    try { j = await (await fetch(API + '/quests?' + idFor() + '&tz=' + TZ, { headers: sessionHeaders(live.current.wallet) })).json(); }
    catch { return; }
    if (!j || !Array.isArray(j.quests)) return;
    for (const q of j.quests as Quest[]) {
      if (q.done && !doneQuests.current.has(q.id)) {
        if (seenQuests.current) {
          floatUp(typeof window !== 'undefined' ? window.innerWidth / 2 : 200, 220, '✨ QUEST DONE');
          if (QUEST_LINE[q.id]) { setLine(QUEST_LINE[q.id]); setDim(false); }
        }
        doneQuests.current.add(q.id);
      }
    }
    seenQuests.current = true;
    setQuests({ list: j.quests, done: j.done, total: j.total, daily: j.daily || null });
  }, [idFor, floatUp]);

  useEffect(() => {
    if (!ready || !API) return;
    (async () => { try { const j = await (await fetch(API + '/stats')).json(); if (typeof j.globalWakes === 'number') setGlobal(j.globalWakes); } catch { /* '…' stays */ } })();
    drawBoard(); loadMe(); drawQuests();
    const b = setInterval(drawBoard, 4000);
    const q = setInterval(drawQuests, 6000);
    return () => { clearInterval(b); clearInterval(q); };
  }, [ready, drawBoard, loadMe, drawQuests]);

  // The contract CTA, written by the verifier or not at all.
  useEffect(() => {
    if (!API) return;
    const load = async () => {
      let rep: unknown = null;
      try { rep = await (await fetch(API + '/trust', { headers: { accept: 'application/json' } })).json(); } catch { rep = null; }
      const st = ctaState(rep);
      setCta(st);
      setCaLabel(st.cta ? 'CA: ' + st.cta.short + ' — tap to copy' : st.state === 'not-launched' ? 'CA: not launched yet' : 'CA: unverified');
    };
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  const copyCa = () => {
    const mint = cta && cta.cta ? cta.cta.mint : '';
    if (!mint) {
      setCaLabel('no verified contract to copy — beware impostors');
      setTimeout(() => setCaLabel(cta?.state === 'not-launched' ? 'CA: not launched yet' : 'CA: unverified'), 2000);
      return;
    }
    navigator.clipboard?.writeText(mint).catch(() => {});
    setCaLabel('copied ✅ ' + cta!.cta!.short);
    setTimeout(() => setCaLabel('CA: ' + cta!.cta!.short + ' — tap to copy'), 1500);
  };

  const connect = async () => {
    const provider = (window as any).solana;
    if (!provider?.isPhantom) { setWalletMsg('Phantom not found — opening install…'); window.open('https://phantom.app/', '_blank'); return; }
    try {
      setWalletMsg('sign the message to verify…');
      const resp = await provider.connect();
      const w: string = resp?.publicKey?.toString?.() || '';
      if (!w) throw new Error('no public key');
      const { message } = await (await fetch(API + '/auth/nonce?wallet=' + w)).json();
      if (typeof message !== 'string') throw new Error('no nonce');
      const signed = await provider.signMessage(new TextEncoder().encode(message), 'utf8');
      const v = await (await fetch(API + '/auth/verify', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: w, signature: bs58encode(signed.signature), nonce: message.slice(message.lastIndexOf(' ') + 1) }),
      })).json();
      if (!v.verified) { setWalletMsg('❌ verification failed'); return; }
      const session: string | null = typeof v.session === 'string' && v.session ? v.session : null;
      if (session) saveSession(w, session);
      setWallet(w); setWalletId(w);
      let claimed = 0;
      if (session) {
        try {
          const c = await (await fetch(API + '/claim', {
            method: 'POST', headers: { 'content-type': 'application/json', [SESSION_HEADER]: session },
            body: JSON.stringify({ wallet: w, device: device.current }),
          })).json();
          claimed = c.claimed || 0;
        } catch { /* connect stands; claim retriable */ }
      }
      setWalletMsg('✅ ' + shortAddr(w) + ' connected' + (claimed > 0 ? ' · claimed ' + claimed.toLocaleString() + ' taps' : session ? '' : ' · guest taps not claimed'));
      drawQuests();
    } catch { setWalletMsg('connect cancelled'); }
  };

  const share = () => {
    const landing = API + '/s?' + idFor();
    const text = `i've woken the NPC ${taps.toLocaleString()} times and she's losing it. tap to wake her too 👇`;
    const intent = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(landing);
    if (typeof navigator !== 'undefined' && (navigator as any).share) (navigator as any).share({ title: '$NPC', text, url: landing }).catch(() => window.open(intent, '_blank'));
    else window.open(intent, '_blank');
  };

  const rows: [string, number][] | null = board.rows && ([...board.rows, ['YOU', taps] as [string, number]].sort((a, b) => b[1] - a[1]).slice(0, 6));

  return (
    <div className="npcg-root">
      <Head><title>$NPC — tap to wake her</title></Head>
      <style>{CSS}</style>

      <div className="npcg-wrap">
        <header className="npcg-head">
          <div className="npcg-logo">$<b>NPC</b></div>
          <button onClick={copyCa} className="npcg-ca" title="the mint, once the verifier publishes one">{caLabel}</button>
        </header>

        <div className="npcg-stage">
          {floats.map((f) => <span key={f.id} className="npcg-float" style={{ left: f.x, top: f.y }}>{f.text}</span>)}
          <div className={'npcg-line' + (dim ? ' dim' : '')}>{line}</div>
          <button
            className={'npcg-face' + (awake < 15 ? ' sleepy' : '')}
            onClick={(e) => tap(e.clientX, e.clientY)}
            onTouchStart={(e) => { e.preventDefault(); const t = e.touches[0]; tap(t?.clientX ?? 200, t?.clientY ?? 300); }}
            aria-label="tap to wake her"
          >{faceFor(awake)}</button>
          {coach && <div className="npcg-coach"><b>TAP TO WAKE HER 👆</b><div>she's asleep inside the market. keep tapping.</div></div>}
          <div className="npcg-bar-row"><span>AWAKENESS</span><span>{Math.floor(awake)}%</span></div>
          <div className="npcg-bar"><span style={{ width: awake + '%' }} /></div>
        </div>

        <div className="npcg-grid">
          <Stat k="YOUR TAPS" v={taps.toLocaleString()} neon sub={level ? `LVL ${level.level} · ${level.title} · ${level.tapsToNext == null ? 'max' : level.tapsToNext.toLocaleString() + ' to ' + level.nextTitle}` : ''} />
          <Stat k="GLOBAL WAKES" v={global === null ? '…' : Math.floor(global).toLocaleString()} />
          <div className="npcg-card npcg-span">
            <div className="npcg-k">DAILY STREAK</div>
            <div className={'npcg-v' + (streak ? ' neon' : '')}>{streak ? `🔥 ${streak.streak} ${streak.streak === 1 ? 'day' : 'days'}${streak.best > streak.streak ? ' · best ' + streak.best : ''}` : '— come back daily'}</div>
          </div>
        </div>

        {cta && cta.cta && (
          <div className="npcg-cta-row">
            <a className="npcg-buy" href={cta.cta.buy} target="_blank" rel="noopener noreferrer">BUY $NPC</a>
            <a className="npcg-chart" href={cta.cta.chart} target="_blank" rel="noopener noreferrer">📈 CHART</a>
          </div>
        )}
        {cta && cta.state !== 'live' && (
          <div className={'npcg-notice ' + cta.state}><b>{cta.title}</b> {cta.detail}</div>
        )}

        <button onClick={share} className="npcg-btn">📣 Share my wakes</button>

        <Panel title="Top Wakers">
          {rows === null ? <div className="npcg-muted">leaderboard unavailable — the api did not answer</div>
            : rows.length === 1 && taps <= 0 ? <div className="npcg-muted">nobody has woken her yet. be the first.</div>
              : rows.map(([who, n], i) => (
                <div key={who + i} className="npcg-lb">
                  <span><span className="npcg-rank">{i + 1}</span><span className={who === 'YOU' ? 'neon' : ''}>{who === 'YOU' ? 'YOU' : String(who).slice(0, 10)}</span></span>
                  <span>{Number(n).toLocaleString()}</span>
                </div>
              ))}
        </Panel>

        <Panel title={quests ? `Quests · ${quests.done}/${quests.total}` : 'Quests'}>
          {quests?.daily && <QuestRow {...quests.daily} label={'☀️ ' + quests.daily.label} />}
          {quests?.list.map((q) => <QuestRow key={q.id} {...q} />)}
        </Panel>

        <div className="npcg-links"><a href="/">🎤 Talk to her</a><a href="/trust">🛡️ Trust</a></div>

        <button onClick={connect} className="npcg-btn">{wallet ? '🔗 Connected' : '🔗 Connect Phantom'}</button>
        <div className="npcg-muted npcg-center">{walletMsg}</div>

        <p className="npcg-fine">
          $NPC is a meme collectible for entertainment. It has no intrinsic value, no team, no roadmap promises,
          and is not an investment or financial advice. Nothing here is a promise of profit. Fair launch only.
        </p>
      </div>
    </div>
  );
}

function Stat({ k, v, neon, sub }: { k: string; v: string; neon?: boolean; sub?: string }) {
  return <div className="npcg-card"><div className="npcg-k">{k}</div><div className={'npcg-v' + (neon ? ' neon' : '')}>{v}</div>{sub ? <div className="npcg-sub">{sub}</div> : null}</div>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="npcg-panel"><h3>{title}</h3>{children}</div>;
}
function QuestRow({ label, progress, goal, done, reward }: { label: string; progress: number; goal: number; done: boolean; reward: string }) {
  const pct = Math.min(100, Math.round((100 * progress) / goal));
  return (
    <div className={'npcg-quest' + (done ? ' done' : '')}>
      <div className="npcg-quest-top"><span>{label}</span><span>{done ? '✅' : `${progress}/${goal}`}</span></div>
      <div className="npcg-quest-bar"><span style={{ width: pct + '%' }} /></div>
      <div className="npcg-sub">{done ? '🎁 ' + reward : reward}</div>
    </div>
  );
}

const CSS = `
.npcg-root{--bg:#07070c;--panel:#0e0e18;--line:#1c1c2e;--neon:#00ffa3;--violet:#8b5cf6;--dim:#7a7a92;--ink:#e8e8f2;--bad:#ff2e63;--warn:#ffb020;
  position:fixed;inset:0;overflow:auto;background:radial-gradient(900px 500px at 50% -5%,#15152c,var(--bg) 60%);color:var(--ink);font-family:ui-monospace,Menlo,Consolas,monospace;z-index:50}
.npcg-wrap{max-width:420px;margin:0 auto;padding:24px 16px 80px}
.npcg-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px}
.npcg-logo{font-size:20px;font-weight:800}.npcg-logo b{color:var(--neon)}
.npcg-ca{background:none;border:0;color:var(--dim);font:inherit;font-size:11px;cursor:pointer}
.npcg-stage{position:relative;border:1px solid var(--line);background:var(--panel);border-radius:16px;padding:28px 16px;text-align:center}
.npcg-line{min-height:34px;font-size:13px;line-height:1.5;color:var(--ink)}.npcg-line.dim{color:var(--dim)}
.npcg-face{background:none;border:0;cursor:pointer;font-size:86px;line-height:1;margin:12px 0;transition:transform .05s}.npcg-face:active{transform:scale(.95)}.npcg-face.sleepy{opacity:.7}
.npcg-coach{margin-bottom:8px;font-size:13px}.npcg-coach b{color:var(--neon)}.npcg-coach div{font-size:11px;color:var(--dim)}
.npcg-bar-row{display:flex;justify-content:space-between;font-size:10px;letter-spacing:2px;color:var(--dim);margin-bottom:4px}
.npcg-bar{height:8px;border-radius:99px;background:var(--line);overflow:hidden}.npcg-bar>span{display:block;height:100%;background:linear-gradient(90deg,var(--violet),var(--neon));transition:width .2s}
.npcg-float{position:fixed;transform:translate(-50%,0);color:var(--neon);font-weight:800;pointer-events:none;animation:npcg-up .9s ease-out forwards;z-index:60}
@keyframes npcg-up{from{opacity:1;transform:translate(-50%,0)}to{opacity:0;transform:translate(-50%,-40px)}}
.npcg-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.npcg-card{border:1px solid var(--line);background:var(--panel);border-radius:12px;padding:12px}
.npcg-span{grid-column:span 2}
.npcg-k{font-size:10px;letter-spacing:2px;color:var(--dim)}
.npcg-v{font-size:18px;font-weight:700}.npcg-v.neon{color:var(--neon)}
.npcg-sub{font-size:10px;color:var(--dim);margin-top:4px}
.npcg-cta-row{display:flex;gap:8px;margin-top:12px}
.npcg-buy{flex:1;text-align:center;padding:12px;border-radius:12px;font-weight:800;text-decoration:none;color:#04120b;background:linear-gradient(90deg,var(--violet),var(--neon))}
.npcg-chart{flex:1;text-align:center;padding:12px;border-radius:12px;font-weight:700;text-decoration:none;color:var(--ink);border:1px solid var(--line)}
.npcg-notice{margin-top:12px;border:1px solid var(--line);border-radius:12px;padding:12px;font-size:12px;line-height:1.5;color:var(--dim)}
.npcg-notice.unsafe{border-color:var(--bad);color:var(--bad)}.npcg-notice.caution{border-color:var(--warn);color:var(--warn)}
.npcg-btn{margin-top:12px;width:100%;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:12px;padding:12px;font:inherit;font-weight:700;cursor:pointer}
.npcg-panel{margin-top:20px;border:1px solid var(--line);background:var(--panel);border-radius:12px;padding:12px}
.npcg-panel h3{font-size:11px;text-transform:uppercase;letter-spacing:2px;color:var(--dim);margin:0 0 8px}
.npcg-lb{display:flex;justify-content:space-between;border-bottom:1px dashed var(--line);padding:8px 0;font-size:13px}
.npcg-rank{color:var(--dim);margin-right:8px}.neon{color:var(--neon)}
.npcg-muted{font-size:12px;color:var(--dim)}.npcg-center{text-align:center;min-height:14px;margin-top:4px}
.npcg-quest{margin-bottom:8px}.npcg-quest.done{opacity:.7}
.npcg-quest-top{display:flex;justify-content:space-between;font-size:12px}
.npcg-quest-bar{height:6px;border-radius:99px;background:var(--line);overflow:hidden;margin:4px 0}.npcg-quest-bar>span{display:block;height:100%;background:linear-gradient(90deg,var(--violet),var(--neon))}
.npcg-links{display:flex;justify-content:center;gap:16px;margin-top:16px;font-size:12px}.npcg-links a{color:var(--dim);text-decoration:none}
.npcg-fine{margin-top:24px;text-align:center;font-size:10px;line-height:1.6;color:var(--dim)}
`;
