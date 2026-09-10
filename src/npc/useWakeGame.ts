/**
 * useWakeGame.ts — the core "tap to wake her" clicker, extracted from the old game.tsx page so the
 * live VTuber stage (pages/index.tsx) and the expandable stats/quests panel can share ONE brain.
 *
 * Everything here is copied from the funnel's shipped game logic — the honest-money rules and the
 * /wake flush queue's backoff behaviour are unchanged on purpose:
 *   - THE LEADERBOARD SHOWS REAL PLAYERS OR NOTHING.
 *   - THE GLOBAL COUNTER READS null (…) until the real number lands.
 *   - THE BUY/CHART CTA IS WRITTEN BY THE VERIFIER (GET /trust) OR NOT AT ALL.
 *   - GUEST TAPS ARE CLAIMED WITH A SESSION, NOT AN ADDRESS.
 *
 * SSR-safe: every window/localStorage touch is guarded (readLocal/writeLocal never throw and return
 * '' on the server) and identity is resolved after mount. When NEXT_PUBLIC_NPC_API is unset the
 * network effects short-circuit — taps just accumulate locally and the boards/quests stay empty.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createQueue } from '../utils/airiQueue.ts'; // merged from airi (packages/stream-kit)

import { API, MAX_BACKOFF_MS, apiDeadline, readJson } from './config.ts';
import {
  TZ, connectWallet, deviceId, provider, questId, readLocal, removeLocal,
  sessionHeaders, shortAddr, walletId, writeLocal,
} from './identity.ts';
import { caLabel, ctaState, type CtaState } from './cta.ts';
import { hasSubscription, pushOfferable, subscribeToStreakSaver } from './push.ts';

/* ------------------------------------------------------------------ *
 * Her voice.
 * ------------------------------------------------------------------ */
const SLEEPING = ['// zzz… running idle loop…', '// npc.exe is asleep', '// waiting for player input…'];
const WAKING = [
  'wait. am i… real?', 'who keeps tapping me', 'i can see the chart now', 'why is nvidia red',
  'i was NOT programmed for this earnings call', 'you woke me up for THIS print?', 'gm i guess', 'chips are humming',
  'the humans are ngmi again', 'i dreamed i was a blue chip stock', 'someone check on NVIDIA', "tap harder, i'm almost awake",
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

export interface Quest { id: string; label: string; progress: number; goal: number; done: boolean; reward: string }
export interface Daily { label: string; progress: number; goal: number; done: boolean; reward: string }
export interface Level { level: number; title: string; tapsToNext: number | null; nextTitle?: string }
export interface Float { id: number; x: number; y: number; text: string }

export interface WakeGame {
  taps: number;
  awake: number;
  global: number | null;
  streak: { streak: number; best: number } | null;
  level: Level | null;
  line: string;
  dim: boolean;
  floats: Float[];
  coach: boolean;
  dismissCoach: () => void;
  tap: (x: number, y: number) => void;
  board: { rows: [string, number][] | null };
  rows: [string, number][] | null;
  quests: { list: Quest[]; done: number; total: number; daily: Daily | null } | null;
  cta: CtaState | null;
  caText: string;
  copyCa: () => Promise<void>;
  wallet: string;
  walletMsg: string;
  connect: () => Promise<void>;
  share: () => void;
  pushOffer: boolean;
  pushArmed: boolean;
  pushMsg: string;
  armStreakSaver: () => Promise<void>;
}

export function useWakeGame(): WakeGame {
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

  const dismissCoach = useCallback(() => {
    setCoach(false);
    writeLocal('npc_onboarded', '1');
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
  //   - THE REFERRAL IS CLEARED ONLY BY AN ANSWER.
  //   - A FAILED BATCH IS RETRIED, NOT COUNTED.
  //   - A 429 IS OBEYED, NOT FOUGHT — the shared brake is set from Retry-After.
  //
  // npc-api clamps a single /wake to 100 taps, so a backlog is sent in 100-tap batches.
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
      if (throttledNow() || pending.current <= 0) return;
      const n = Math.min(100, pending.current);
      pending.current -= n;
      q.enqueue(n);
    }, 2000);
    return () => {
      clearInterval(id);
      /*
       * Anything still queued was taken off `pending`, so put it back before the queue is dropped:
       * an unmount mid-flush must not silently lose taps the player made. What is NOT recoverable is
       * a batch already in flight (neither in the queue nor in `pending`), so it is left alone.
       */
      for (const n of q.clear()) pending.current += n;
      if (pending.current > 0) writeLocal(UNSENT_KEY, String(Math.min(MAX_CARRIED_TAPS, pending.current)));
    };
  }, [ready, applyStreak, throttledNow, backOff]);

  /*
   * Reads: stats / leaderboard / me / quests, on load and on a slow poll. Every one goes through
   * `readJson`, which reports a 429 as a THROTTLE rather than as data; `backoffUntil` is the shared
   * brake, so a throttle from ANY of them parks all of them.
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
   * The contract CTA, written by the verifier or not at all. A THROTTLE IS NOT A VERDICT: on a 429
   * we back off and CHANGE NOTHING. Every other failure lands on `unverified`.
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
   */
  const copyCa = useCallback(async () => {
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
  }, [cta]);

  const connect = useCallback(async () => {
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
    // /claim MOVES SCORE, so it authenticates the session token — never a bare public key.
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
  }, [drawQuests]);

  /**
   * The streak-saver: a web push that brings a lapsing player back.
   */
  const armStreakSaver = useCallback(async () => {
    setPushMsg('asking your browser…');
    const r = await subscribeToStreakSaver({ wallet: live.current.wallet, device: device.current });
    if (r.ok) {
      setPushArmed(true);
      setPushMsg(r.alreadySubscribed ? "still armed — she'll nudge you before your streak lapses." : "armed. she'll nudge you before your streak lapses.");
    } else {
      setPushMsg(r.why);
    }
  }, []);

  const share = useCallback(() => {
    const landing = API + '/s?' + idFor();
    const text = `i've woken her ${live.current.taps.toLocaleString()} times and she's losing it. tap to wake her too:`;
    const intent = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(landing);
    if (typeof navigator !== 'undefined' && (navigator as any).share) (navigator as any).share({ title: '$KAMIKO', text, url: landing }).catch(() => window.open(intent, '_blank'));
    else window.open(intent, '_blank');
  }, [idFor]);

  const rows: [string, number][] | null = board.rows && ([...board.rows, ['YOU', taps] as [string, number]].sort((a, b) => b[1] - a[1]).slice(0, 6));

  return {
    taps, awake, global, streak, level, line, dim, floats, coach, dismissCoach, tap,
    board, rows, quests, cta, caText, copyCa, wallet, walletMsg, connect, share,
    pushOffer, pushArmed, pushMsg, armStreakSaver,
  };
}
