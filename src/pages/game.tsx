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
 * It is decoupled from the bun workspace on purpose (amica is a separate npm app), so the helpers it
 * needs live in `src/npc/` inside amica rather than being imported across the workspace boundary.
 * They are a module, not an inline copy: the holder dashboard runs the SAME wallet handshake and the
 * SAME fail-closed CTA reading, and two copies of an auth flow is how they drift apart.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { createQueue } from '../utils/airiQueue.ts'; // merged from airi (packages/stream-kit)

import { API, MAX_BACKOFF_MS, apiDeadline, readJson } from '../npc/config.ts';
import {
  TZ, connectWallet, deviceId, provider, questId, readLocal, removeLocal,
  sessionHeaders, shortAddr, walletId, writeLocal,
} from '../npc/identity.ts';
import { caLabel, ctaState, type CtaState } from '../npc/cta.ts';
import { hasSubscription, pushOfferable, subscribeToStreakSaver } from '../npc/push.ts';
import { NPC_CSS } from '../npc/styles.ts';
import {
  BellIcon, BotIcon, ChartIcon, CheckIcon, FlameIcon, GemIcon, GiftIcon,
  LinkIcon, MicIcon, NpcFace, ShareIcon, ShieldIcon,
} from '../npc/icons.tsx';

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
/**
 * Taps counted locally that /wake has not accepted yet, parked across a page unload.
 *
 * The cap is not a storage concern — it is a ceiling on what one restore may add to the global
 * counter. Anything larger than this is a corrupted or hand-edited value, and honouring it would
 * let a client inflate the one number on this page that is supposed to be the server's.
 */
const UNSENT_KEY = 'npc_unsent';
const MAX_CARRIED_TAPS = 10_000;

const pick = (pool: string[]) => pool[Math.floor(Math.random() * pool.length)];

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
  const [caText, setCaText] = useState('CA: unverified');
  const [wallet, setWallet] = useState('');
  const [walletMsg, setWalletMsg] = useState('');
  const [floats, setFloats] = useState<Float[]>([]);
  const [ready, setReady] = useState(false);
  const [pushOffer, setPushOffer] = useState(false);
  const [pushArmed, setPushArmed] = useState(false);
  const [pushMsg, setPushMsg] = useState('');

  const device = useRef('');
  /**
   * Epoch ms until which every polled read is skipped, set from a 429's Retry-After.
   * A ref, not state: the poll callbacks read it on every tick and a re-render per throttle would
   * be pure noise on a page that is already animating.
   */
  const backoffUntil = useRef(0);
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
    /*
     * Taps this browser counted locally and never got accepted by /wake, carried over from a
     * previous visit (see the flush loop's cleanup). Read ONCE and erased immediately: the value is
     * re-written on the next unmount, and a key that survived a restore would be restored again
     * after any crash that skipped the unmount — turning a recovery into an inflation of the one
     * number this page promises is real.
     */
    const carried = Math.max(0, Math.min(MAX_CARRIED_TAPS, Math.floor(Number(readLocal(UNSENT_KEY)) || 0)));
    removeLocal(UNSENT_KEY);
    if (carried > 0) pending.current += carried;
    setReady(true);
    // Whether the streak saver can be OFFERED at all is a client-side question (browser support, a
    // configured VAPID key, permission not already denied). Asking for permission is not: that
    // happens on the button, never on load, because an unprompted permission dialog is penalised by
    // every browser and outright blocked by some.
    setPushOffer(pushOfferable());
    hasSubscription().then(setPushArmed).catch(() => setPushArmed(false));
  }, []);

  /** Are we inside a backoff window the server asked for? */
  const throttledNow = useCallback(() => Date.now() < backoffUntil.current, []);
  /** Park every polled read until `ms` from now (never shortens an existing, longer window). */
  const backOff = useCallback((ms: number) => {
    backoffUntil.current = Math.max(backoffUntil.current, Date.now() + ms);
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
  // the way a bare setInterval(fetch) could when a request outran the 2s tick.
  //
  // Two rules this loop got wrong and now gets right, both of them about what a FAILED send means:
  //
  //   - THE REFERRAL IS CLEARED ONLY BY AN ANSWER. `ref.current = ''` used to run the instant the
  //     fetch resolved — before `r.ok` was looked at and before the body was read — so any 429, 500
  //     or bridge 502 permanently destroyed the `?ref=` that brought this player in. The referral is
  //     attributed once, ever, server-side; losing it here loses the invite quest and the growth
  //     funnel with no retry and no sign anything happened.
  //   - A FAILED BATCH IS RETRIED, NOT COUNTED. The error handler used to ADD the batch to the
  //     global counter, on top of the optimistic +1 `tap()` already applied — inflating the one
  //     number this page promises is real or absent. The taps go back on the pending pile instead,
  //     so the next tick resends them and the authoritative `globalWakes` in that answer corrects
  //     the optimistic local count.
  //
  //   - A 429 IS OBEYED, NOT FOUGHT. npc-api rate-limits /wake (120/min), and a throttled batch is
  //     still `!r.ok`, so retrying it on the normal 2s tick is a client answering its own rate
  //     limit by spending the rest of its budget on the request that was already refused. The
  //     batch goes back on the pile AND the shared brake is set from Retry-After, which is the
  //     same brake the read loops honour — one throttle parks every call this page makes, because
  //     they all share one bucket per client.
  //
  // npc-api clamps a single /wake to 100 taps, so a backlog is sent in 100-tap batches rather than
  // one oversized post the server would silently truncate.
  useEffect(() => {
    if (!ready || !API) return;
    const q = createQueue<number>({
      handlers: [async ({ data: n }) => {
        const sentRef = ref.current;
        const r = await fetch(API + '/wake', {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: apiDeadline(),
          body: JSON.stringify({ taps: n, wallet: live.current.wallet || undefined, device: device.current, tz: TZ, ref: sentRef || undefined }),
        });
        if (r.status === 429) {
          // Read the server's own wait before throwing, so the brake is set from what it asked for
          // rather than from a guess. The throw is what puts the taps back on the pile.
          const header = Number(r.headers.get('retry-after'));
          let seconds = Number.isFinite(header) && header > 0 ? header : 0;
          if (!seconds) {
            try {
              const body = (await r.json()) as { retryAfterSec?: unknown };
              const b = Number(body?.retryAfterSec);
              if (Number.isFinite(b) && b > 0) seconds = b;
            } catch { /* no readable body — the floor below applies */ }
          }
          backOff(Math.min(MAX_BACKOFF_MS, Math.max(1000, seconds * 1000)));
          throw new Error('/wake throttled');
        }
        // Throw so the queue's `error` event runs and the taps (and the ref) survive.
        if (!r.ok) throw new Error('/wake answered HTTP ' + r.status);
        const j = await r.json();
        // The api has now seen this ref exactly once — attributed or rejected, either way it is spent.
        if (sentRef) ref.current = '';
        if (typeof j.globalWakes === 'number') setGlobal(j.globalWakes);
        applyStreak(j.streak, j.bestStreak);
      }],
    });
    q.on('error', (n) => { pending.current += n as number; });
    const id = setInterval(() => {
      // Nothing is sent while the server has asked us to wait — the taps keep accumulating in
      // `pending` and go out in one batch when the window expires, which is also fewer requests.
      if (throttledNow() || pending.current <= 0) return;
      const n = Math.min(100, pending.current);
      pending.current -= n;
      q.enqueue(n);
    }, 2000);
    return () => {
      clearInterval(id);
      /*
       * Anything still queued was taken off `pending`, so put it back before the queue is dropped:
       * an unmount mid-flush must not silently lose taps the player made.
       *
       * `clear()` now RETURNS those batches (src/utils/airiQueue.ts — a local divergence from
       * upstream airi, documented there). Before that it returned void and emitted nothing, and the
       * `error` handler above — the only path that restores a batch — fires from `drain`'s catch,
       * which a cleared item never reaches. So this comment promised a recovery the code could not
       * perform, and the observable damage was the locally persisted tap count permanently exceeding
       * the server's, which is what the spliced-in "YOU" leaderboard row is computed from.
       *
       * `pending` is a component ref and dies with the unmount, so the restored total is also
       * written to storage for the next visit to resend. What is NOT recoverable is a batch already
       * in flight: it is neither in the queue nor in `pending`, and the server may well have
       * accepted it — putting that one back would double-count it, which is the wrong direction to
       * be wrong on the number this page promises is real.
       */
      for (const n of q.clear()) pending.current += n;
      if (pending.current > 0) writeLocal(UNSENT_KEY, String(Math.min(MAX_CARRIED_TAPS, pending.current)));
    };
  }, [ready, applyStreak, throttledNow, backOff]);

  /*
   * Reads: stats / leaderboard / me / quests, on load and on a slow poll.
   *
   * Every one of them goes through `readJson`, which reports a 429 as a THROTTLE rather than as
   * data. That matters because services/game-api now rate-limits its public GETs: a throttled
   * response is JSON, so the old `(await fetch(...)).json()` parsed it happily and handed the
   * loop `{error: 'rate limited'}` — the board rendered empty and the loop asked again 4 seconds
   * later, which is a page answering its own rate limit by hitting the limit harder.
   *
   * `backoffUntil` is the shared brake: a throttle from ANY of these parks all of them, because
   * they share one bucket per client and racing to be the one that recovers first just spends the
   * budget on whichever loop is fastest.
   */
  const drawBoard = useCallback(async () => {
    if (throttledNow()) return;
    const r = await readJson<{ leaderboard?: Array<{ wallet: string; count: number }> }>(API + '/leaderboard?limit=5');
    if (!r.ok) {
      if (r.throttled) { backOff(r.retryAfterMs); return; } // keep the last real board on screen
      setBoard({ rows: null }); // a real failure: the funnel shows nothing rather than stale names
      return;
    }
    setBoard({ rows: (r.data.leaderboard || []).map((x) => [x.wallet, x.count] as [string, number]) });
  }, [throttledNow, backOff]);

  const loadMe = useCallback(async () => {
    if (throttledNow()) return;
    const r = await readJson<{ streak?: number; bestStreak?: number; level?: Level; greeting?: string; taps?: number }>(
      API + '/me?' + idFor(),
    );
    if (!r.ok) {
      if (r.throttled) backOff(r.retryAfterMs);
      return; // leave her idle chatter
    }
    const j = r.data;
    applyStreak(j.streak, j.bestStreak);
    if (j.level) setLevel(j.level);
    if (j.greeting && ((j.taps ?? 0) > 0 || (j.bestStreak ?? 0) > 0)) { setLine(j.greeting); setDim(true); }
  }, [idFor, applyStreak, throttledNow, backOff]);

  const drawQuests = useCallback(async () => {
    if (throttledNow()) return;
    const r = await readJson<any>(API + '/quests?' + idFor() + '&tz=' + TZ, { headers: sessionHeaders(live.current.wallet) });
    if (!r.ok) {
      if (r.throttled) backOff(r.retryAfterMs);
      return;
    }
    const j = r.data;
    if (!j || !Array.isArray(j.quests)) return;
    for (const q of j.quests as Quest[]) {
      if (q.done && !doneQuests.current.has(q.id)) {
        if (seenQuests.current) {
          floatUp(typeof window !== 'undefined' ? window.innerWidth / 2 : 200, 220, 'QUEST DONE');
          if (QUEST_LINE[q.id]) { setLine(QUEST_LINE[q.id]); setDim(false); }
        }
        doneQuests.current.add(q.id);
      }
    }
    seenQuests.current = true;
    setQuests({ list: j.quests, done: j.done, total: j.total, daily: j.daily || null });
  }, [idFor, floatUp, throttledNow, backOff]);

  useEffect(() => {
    if (!ready || !API) return;
    (async () => {
      const r = await readJson<{ globalWakes?: number }>(API + '/stats');
      if (r.ok && typeof r.data.globalWakes === 'number') setGlobal(r.data.globalWakes);
      else if (!r.ok && r.throttled) backOff(r.retryAfterMs);
      // otherwise the counter stays '…' — it never shows a seeded number that later collapses
    })();
    drawBoard(); loadMe(); drawQuests();
    const b = setInterval(drawBoard, 4000);
    const q = setInterval(drawQuests, 6000);
    return () => { clearInterval(b); clearInterval(q); };
  }, [ready, drawBoard, loadMe, drawQuests]);

  /*
   * The contract CTA, written by the verifier or not at all.
   *
   * A THROTTLE IS NOT A VERDICT. GET /trust is rate-limited like the other public GETs now, and a
   * 429 is JSON — so the old `.json()` handed `{error:'rate limited'}` to `ctaState`, which
   * correctly refuses to recognise it and returns `unverified`. The result was that hitting our own
   * rate limit made the page stop showing the real, verified contract and tell visitors it could
   * not confirm one: the funnel disowning its own mint because it polled too fast. On a throttle we
   * back off and CHANGE NOTHING — the last answer the verifier actually gave stands until it gives
   * another. Every other failure still lands on `unverified`, which is the honest fail-closed state
   * for "we could not ask".
   */
  useEffect(() => {
    if (!API) return;
    const load = async () => {
      const r = await readJson<unknown>(API + '/trust', { headers: { accept: 'application/json' } });
      if (!r.ok && r.throttled) { backOff(r.retryAfterMs); return; }
      const st = ctaState(r.ok ? r.data : null);
      setCta(st);
      setCaText(caLabel(st));
    };
    load();
    const id = setInterval(() => { if (!throttledNow()) load(); }, 60000);
    return () => clearInterval(id);
  }, [throttledNow, backOff]);

  /**
   * Copy the verified mint — and say "copied" only when the clipboard actually took it.
   *
   * Both failure paths used to be silent. `navigator.clipboard` is undefined on a non-secure origin
   * and in several mobile in-app browsers, where the optional chain made the write a no-op; and a
   * rejected `writeText` — a denied clipboard permission, a call outside a user gesture — was
   * swallowed by an empty `.catch`. The header said "copied ✅" in both cases, so the user pasted
   * into a swap and got whatever was on their clipboard before, which on a memecoin buyer's
   * clipboard is very often another token address somebody sent them. Everything else on this page
   * refuses to state an outcome it did not verify; this is the same rule applied to the clipboard.
   *
   * On failure it prints the FULL mint rather than an apology, so the address can still be selected
   * by hand — and it does not auto-revert, because a message you need to read and copy from must not
   * disappear after a second and a half.
   */
  const copyCa = async () => {
    const mint = cta && cta.cta ? cta.cta.mint : '';
    const short = cta && cta.cta ? cta.cta.short : '';
    if (!mint) {
      setCaText('no verified contract to copy — beware impostors');
      setTimeout(() => setCaText(caLabel(cta)), 2000);
      return;
    }
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        throw new Error('no clipboard api');
      }
      await navigator.clipboard.writeText(mint);
    } catch {
      setCaText('could not copy — the address is ' + mint);
      return;
    }
    setCaText('copied · ' + short);
    setTimeout(() => setCaText(caLabel(cta)), 1500);
  };

  const connect = async () => {
    const p = provider();
    if (!p) { setWalletMsg('Phantom not found — opening install…'); window.open('https://phantom.app/', '_blank', 'noopener'); return; }
    let w = '';
    let session = '';
    try {
      setWalletMsg('sign the message to verify…');
      ({ wallet: w, session } = await connectWallet(p));
    } catch {
      setWalletMsg('connect cancelled');
      return;
    }
    setWallet(w);
    // /claim MOVES SCORE, so it authenticates the session token — never a bare public key, which is
    // public and printed on the leaderboard. Without a token the connect still stands; the guest
    // taps just stay on the device id until a session exists.
    let claimed = 0;
    if (session) {
      try {
        const c = await (await fetch(API + '/claim', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...sessionHeaders(session) },
          signal: apiDeadline(),
          body: JSON.stringify({ wallet: w, device: device.current }),
        })).json();
        claimed = Number(c?.claimed) || 0;
      } catch { /* connect stands; the claim is retried on the next connect */ }
    }
    setWalletMsg(shortAddr(w) + ' connected'
      + (claimed > 0 ? ' · claimed ' + claimed.toLocaleString() + ' taps' : session ? '' : ' · guest taps not claimed'));
    drawQuests();
  };

  /**
   * The streak-saver: a web push that brings a lapsing player back.
   *
   * services/game-api ships the whole server half of this (webpush.ts, push.ts, push-admin.ts) and
   * nothing ever subscribed, so `push_subs` stayed empty and every sweep found nobody to remind.
   * The offer only renders when this deployment can actually deliver one — a configured VAPID key,
   * a supporting browser, permission not already denied — because a subscription minted against the
   * wrong key is one the server can never push to.
   */
  const armStreakSaver = async () => {
    setPushMsg('asking your browser…');
    const r = await subscribeToStreakSaver({ wallet: live.current.wallet, device: device.current });
    if (r.ok) {
      setPushArmed(true);
      setPushMsg(r.alreadySubscribed ? "still armed — she'll nudge you before your streak lapses." : "armed. she'll nudge you before your streak lapses.");
    } else {
      setPushMsg(r.why);
    }
  };

  const share = () => {
    const landing = API + '/s?' + idFor();
    const text = `i've woken the NPC ${taps.toLocaleString()} times and she's losing it. tap to wake her too:`;
    const intent = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(landing);
    if (typeof navigator !== 'undefined' && (navigator as any).share) (navigator as any).share({ title: '$NPC', text, url: landing }).catch(() => window.open(intent, '_blank'));
    else window.open(intent, '_blank');
  };

  const rows: [string, number][] | null = board.rows && ([...board.rows, ['YOU', taps] as [string, number]].sort((a, b) => b[1] - a[1]).slice(0, 6));

  return (
    <div className="npcg-root">
      <Head><title>$NPC — tap to wake her</title></Head>
      {/* raw-text element — see agents.tsx: a text child is SSR entity-escaped (`>` → `&gt;`) and
          never un-escaped, breaking `.npcg-bar>span` pre-hydration and mismatching hydration. */}
      <style dangerouslySetInnerHTML={{ __html: NPC_CSS }} />

      <div className="npcg-wrap">
        <header className="npcg-head">
          <div className="npcg-logo">$<b>NPC</b></div>
          <button onClick={copyCa} className="npcg-ca" title="the mint, once the verifier publishes one">{caText}</button>
        </header>

        <div className="npcg-stage">
          {floats.map((f) => <span key={f.id} className="npcg-float" style={{ left: f.x, top: f.y }}>{f.text}</span>)}
          <div className={'npcg-line' + (dim ? ' dim' : '')}>{line}</div>
          <button
            className={'npcg-face' + (awake < 15 ? ' sleepy' : '')}
            onClick={(e) => tap(e.clientX, e.clientY)}
            onTouchStart={(e) => { e.preventDefault(); const t = e.touches[0]; tap(t?.clientX ?? 200, t?.clientY ?? 300); }}
            aria-label="tap to wake her"
          ><NpcFace awake={awake} /></button>
          {coach && <div className="npcg-coach"><b>TAP TO WAKE HER</b><div>she's asleep inside the market. keep tapping.</div></div>}
          <div className="npcg-bar-row"><span>AWAKENESS</span><span>{Math.floor(awake)}%</span></div>
          <div className="npcg-bar"><span style={{ width: awake + '%' }} /></div>
        </div>

        <div className="npcg-grid">
          <Stat k="YOUR TAPS" v={taps.toLocaleString()} neon sub={level ? `LVL ${level.level} · ${level.title} · ${level.tapsToNext == null ? 'max' : level.tapsToNext.toLocaleString() + ' to ' + level.nextTitle}` : ''} />
          <Stat k="GLOBAL WAKES" v={global === null ? '…' : Math.floor(global).toLocaleString()} />
          <div className="npcg-card npcg-span">
            <div className="npcg-k">DAILY STREAK</div>
            <div className={'npcg-v' + (streak ? ' neon' : '')}>{streak ? <><FlameIcon /> {streak.streak} {streak.streak === 1 ? 'day' : 'days'}{streak.best > streak.streak ? ' · best ' + streak.best : ''}</> : '— come back daily'}</div>
          </div>
        </div>

        {cta && cta.cta && (
          <div className="npcg-cta-row">
            <a className="npcg-buy" href={cta.cta.buy} target="_blank" rel="noopener noreferrer">BUY $NPC</a>
            <a className="npcg-chart" href={cta.cta.chart} target="_blank" rel="noopener noreferrer"><ChartIcon /> CHART</a>
          </div>
        )}
        {cta && cta.state !== 'live' && (
          <div className={'npcg-notice ' + cta.state}><b>{cta.title}</b> {cta.detail}</div>
        )}

        <button onClick={share} className="npcg-btn"><ShareIcon /> Share my wakes</button>

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
          {quests?.daily && <QuestRow {...quests.daily} label={quests.daily.label} daily />}
          {quests?.list.map((q) => <QuestRow key={q.id} {...q} />)}
        </Panel>

        <div className="npcg-links">
          <a href="/"><MicIcon /> Talk to her</a>
          <a href="/holder"><GemIcon /> Holder</a>
          <a href="/trust"><ShieldIcon /> Trust</a>
          <a href="/agents"><BotIcon /> Agents</a>
        </div>

        <button onClick={connect} className="npcg-btn"><LinkIcon /> {wallet ? shortAddr(wallet) : 'Connect Phantom'}</button>
        <div className="npcg-muted npcg-center">{walletMsg}</div>

        {pushOffer && (
          <>
            <button onClick={armStreakSaver} disabled={pushArmed} className="npcg-btn">
              <BellIcon /> {pushArmed ? 'Streak saver armed' : 'Remind me before my streak dies'}
            </button>
            <div className="npcg-muted npcg-center">{pushMsg}</div>
          </>
        )}

        <p className="npcg-fine">
          Not financial advice. $NPC isn&apos;t live yet — no official contract exists.
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
function QuestRow({ label, progress, goal, done, reward, daily }: { label: string; progress: number; goal: number; done: boolean; reward: string; daily?: boolean }) {
  const pct = Math.min(100, Math.round((100 * progress) / goal));
  return (
    <div className={'npcg-quest' + (done ? ' done' : '')}>
      <div className="npcg-quest-top"><span>{daily ? <span className="npcg-daily">DAILY</span> : null}{label}</span><span>{done ? <CheckIcon /> : `${progress}/${goal}`}</span></div>
      <div className="npcg-quest-bar"><span style={{ width: pct + '%' }} /></div>
      <div className="npcg-sub">{done ? <><GiftIcon /> {reward}</> : reward}</div>
    </div>
  );
}
