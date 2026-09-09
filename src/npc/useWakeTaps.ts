/**
 * useWakeTaps.ts — the tap engine, headless, so "tap to wake her" can run on the screen she is on.
 *
 * WHY THIS EXISTS.
 * The clicker is called "tap to wake her" and, until this file, it ran on `/game` — a route that
 * does not render the avatar at all (game.tsx imports no VrmViewer) and whose idea of her voice is
 * three hardcoded string pools picked at random (SLEEPING / WAKING / HYPED). So the loop built to
 * make people come back showed neither her face nor her actual brain, while both sat one
 * navigation away on `/`. Tapping woke a counter.
 *
 * Moving the tap surface onto the avatar screen only works if there is ONE engine. game.tsx's flush
 * loop is the part of this product that has been wrong the most times and is now right, and each of
 * its rules was paid for:
 *
 *   - THE REFERRAL IS CLEARED ONLY BY AN ANSWER. `ref` used to be cleared the instant the fetch
 *     resolved, before `r.ok` was read, so any 429 or bridge 502 permanently destroyed the `?ref=`
 *     that brought the player in — attributed once, server-side, with no retry and no sign.
 *   - A FAILED BATCH IS RETRIED, NOT COUNTED. The error path used to ADD the batch to the global
 *     counter on top of the optimistic local +1, inflating the one number this product promises is
 *     real. The taps go back on the pending pile instead.
 *   - A 429 IS OBEYED, NOT FOUGHT. A throttled batch retried on the normal tick is a client
 *     answering its own rate limit by spending the rest of its budget on the refused request.
 *   - AN UNMOUNT MID-FLUSH LOSES NOTHING QUEUED, AND DOUBLE-COUNTS NOTHING IN FLIGHT. `clear()`
 *     returns the queued batches (see src/utils/airiQueue.ts); a batch already sent is neither
 *     restored nor re-counted, because the server may well have taken it.
 *
 * A second copy of that on the avatar screen would be a second set of those bugs. So the engine is
 * here, both surfaces mount it, and the pages keep only their own presentation.
 *
 * WHAT IS DELIBERATELY NOT HERE: the leaderboard, quests, the CTA, the wallet handshake and the
 * push offer. Those are the `/game` dashboard, not the tap loop, and the avatar overlay does not
 * want them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createQueue } from '../utils/airiQueue.ts';
import { API, MAX_BACKOFF_MS, apiDeadline, readJson } from './config.ts';
import { TZ, deviceId, questId, readLocal, removeLocal, walletId, writeLocal } from './identity.ts';

/**
 * Taps counted locally that /wake has not accepted yet, parked across a page unload.
 *
 * Not exported: nothing outside this module may read or write it. The key is half of a recovery
 * protocol — read once, erased immediately, re-written only on unmount — and a second writer would
 * turn that recovery into an inflation of the one number this product promises is the server's.
 */
const UNSENT_KEY = 'npc_unsent';

/**
 * The ceiling on what ONE restore may add to the global counter. Not a storage concern: anything
 * larger than this is a corrupted or hand-edited value, and honouring it would let a client inflate
 * the one number on this product that is supposed to be the server's.
 */
export const MAX_CARRIED_TAPS = 10_000;

/** npc-api clamps a single /wake to 100 taps, so a backlog goes out in batches this size. */
export const WAKE_BATCH = 100;

/** Where the local tap/awake pair is persisted between visits. */
const LOCAL_KEY = 'npc';

/* ------------------------------------------------------------------ *
 * The pure parts, so the curve and the clamp are testable without React
 * ------------------------------------------------------------------ */

/**
 * PURE. How far one tap moves the wake meter.
 *
 * Deliberately non-linear and capped at 100: the last stretch is slow so "fully awake" stays
 * something a player arrives at rather than something two seconds of mashing produces.
 */
export function nextAwake(current: number): number {
  const a = Number.isFinite(current) ? current : 0;
  return Math.min(100, a + (a > 90 ? 0.3 : 1.4));
}

/** PURE. The idle decay applied on a tick once the player has actually started. */
export function decayAwake(current: number): number {
  const a = Number.isFinite(current) ? current : 0;
  return Math.max(0, a - 0.4);
}

/**
 * PURE. How many carried taps a restore may credit.
 *
 * Fails toward ZERO, never toward the stored number: a NaN, a negative, a fractional or an absurd
 * value is somebody editing localStorage, and the honest answer to "how many taps did you make" is
 * not "whatever you typed".
 */
export function carriedTaps(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_CARRIED_TAPS, Math.floor(n));
}

/**
 * The VRM expression names this engine uses. A subset of `emotions` in
 * src/features/chat/messages.ts, kept as a plain union so this module — which the /game dashboard
 * imports and which must not drag in the chat/VRM tree — stays dependency-free.
 */
export type WakeMood = 'Sleep' | 'neutral' | 'Surprised' | 'happy';

/**
 * PURE. What her FACE does as the meter moves.
 *
 * This is the thing that was missing from "tap to wake her": tapping changed a number and she did
 * not react at all. Her expression is what makes waking her legible — and the thresholds are the
 * SAME 15/50/85 the emoji face uses on the /game dashboard, so the emoji and the avatar can never
 * disagree about how awake she is.
 *
 * `Sleep` is a real VRM expression, not "neutral with the lights off": below the first threshold
 * she is asleep, which is the state the whole game exists to end.
 */
export function moodFor(awake: number): WakeMood {
  const a = Number.isFinite(awake) ? awake : 0;
  if (a < 15) return 'Sleep';
  if (a < 50) return 'neutral';
  if (a < 85) return 'Surprised';
  return 'happy';
}

/**
 * Tap counts at which the SERVER has a different thing to say.
 *
 * These are not decorative: services/game-api/greetings.ts's greetingFor() branches on exactly
 * 10, 100 and 1000 lifetime taps, so crossing one is the only moment a re-read of /me produces a
 * genuinely new line. Any other number would spend a request to hear the same sentence.
 *
 * KEEPING THEM IN STEP IS THE POINT. If greetingFor gains a tier, it belongs here too — otherwise
 * she reaches it silently and the player never hears the line that was written for them.
 */
export const GREETING_MILESTONES = [10, 100, 1000] as const;

/**
 * PURE. Did going from `before` to `after` taps cross a milestone?
 *
 * Takes both ends rather than testing equality on the new value, so a batch that jumps the counter
 * (a restored backlog, or a fast tapper between renders) still counts as having crossed it. An
 * `=== 100` test silently misses every player who was ever offline mid-run.
 */
export function crossedMilestone(before: number, after: number): boolean {
  if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before) return false;
  return GREETING_MILESTONES.some((m) => before < m && after >= m);
}

/** PURE. The wait a 429 asked for, in ms, floored so a hostile or missing value cannot mean "now". */
export function backoffMsFor(retryAfterSeconds: unknown): number {
  const s = Number(retryAfterSeconds);
  const ms = Number.isFinite(s) && s > 0 ? s * 1000 : 0;
  return Math.min(MAX_BACKOFF_MS, Math.max(1000, ms));
}

/* ------------------------------------------------------------------ *
 * The hook
 * ------------------------------------------------------------------ */

export interface WakeStreak {
  streak: number;
  best: number;
}

/** The level /me reports. Rendered by the /game dashboard; the overlay does not use it. */
export interface WakeLevel {
  level: number;
  title: string;
  tapsToNext: number | null;
  nextTitle?: string;
}

export interface WakeTaps {
  /**
   * Is there a funnel API to send taps to at all?
   *
   * False when NEXT_PUBLIC_NPC_API is unset, which is a real deployment state — a build shipped
   * without it. Both tap surfaces MUST render this, because the failure is otherwise completely
   * invisible: the local counter still climbs, the meter still fills, the emoji still changes, and
   * nothing has ever reached npc-api. A player taps two hundred times into a page that looks like
   * it is working. /holder and /trust already say so in this situation; the clicker did not.
   */
  configured: boolean;
  /** False until identity has resolved after mount — localStorage is client-only under SSR. */
  ready: boolean;
  /** Lifetime taps this browser has counted, including ones not yet accepted. */
  taps: number;
  /** 0..100. How awake she is right now. */
  awake: number;
  /** The server's global wake count, or null until a real number lands — never a seeded value. */
  global: number | null;
  streak: WakeStreak | null;
  level: WakeLevel | null;
  /** Her current expression, derived from `awake`. See moodFor. */
  mood: WakeMood;
  /** Count one tap. Optimistic locally; the server's answer corrects the global. */
  tap: () => void;
  /** Are we inside a backoff window the server asked for? Shared brake for a host page's reads. */
  throttledNow: () => boolean;
  /** Park every call until `ms` from now (never shortens an existing, longer window). */
  backOff: (ms: number) => void;
  /** This browser's device id, resolved after mount. */
  device: string;
  /** The connected wallet, if the host page has one. */
  wallet: string;
  setWallet: (w: string) => void;
}

export interface WakeTapsOptions {
  /**
   * Called when the SERVER has something for her to say — currently /me's greeting, which is
   * written by her brain rather than picked from a local pool. The avatar screen routes this into
   * the real speak pipeline; /game renders it as a line.
   *
   * Only called when the player has a history (taps or a best streak), because the greeting for
   * somebody the server has never seen is not a greeting.
   */
  onGreeting?: (line: string) => void;
  /** Poll interval for /me, ms. */
  meEveryMs?: number;
}

/**
 * The tap loop: local counting, batched flushes to /wake, the shared throttle brake, and the
 * carried-taps recovery across a page unload.
 */
export function useWakeTaps(options: WakeTapsOptions = {}): WakeTaps {
  const { onGreeting, meEveryMs = 30_000 } = options;

  /*
   * READ ONCE, not on every render.
   *
   * This was a bare IIFE in the component body, so a synchronous localStorage.getItem and a
   * JSON.parse ran on EVERY render — and this hook re-renders on every tap. On /game that was
   * merely wasteful. On the avatar screen it is a blocking storage call on the same main thread
   * that drives the VRM render loop, at whatever rate somebody can click.
   *
   * useState's lazy initialiser is the fix rather than a ref, because it is the one form React
   * guarantees runs exactly once for the life of the component, before the first paint.
   */
  const [saved] = useState<{ taps?: number; awake?: number }>(() => {
    try {
      return JSON.parse(readLocal(LOCAL_KEY) || '{}') as { taps?: number; awake?: number };
    } catch {
      return {};
    }
  });

  const [taps, setTaps] = useState(saved.taps || 0);
  /** The authoritative tap count for the milestone check — see `tap`. Seeded from the restore. */
  const tapCount = useRef<number>(saved.taps || 0);
  const [awake, setAwake] = useState(saved.awake || 0);
  const [global, setGlobal] = useState<number | null>(null);
  const [streak, setStreak] = useState<WakeStreak | null>(null);
  const [level, setLevel] = useState<WakeLevel | null>(null);
  const [ready, setReady] = useState(false);
  const [device, setDevice] = useState('');
  const [wallet, setWallet] = useState('');

  /**
   * Epoch ms until which every polled read is skipped. A ref, not state: the callbacks read it on
   * every tick and a re-render per throttle would be pure noise on a screen that is animating.
   */
  const backoffUntil = useRef(0);
  const pending = useRef(0);
  const ref = useRef('');
  const deviceRef = useRef('');
  const live = useRef({ wallet, taps });
  live.current = { wallet, taps };

  /** Held in a ref so changing the callback cannot restart the flush loop mid-batch. */
  const greetingRef = useRef(onGreeting);
  greetingRef.current = onGreeting;

  /**
   * The /me read, reachable from the tap handler.
   *
   * A milestone is the only moment a re-read says anything new (see GREETING_MILESTONES), and it
   * has to be triggered from `tap` — waiting for the 30s poll means she congratulates you on your
   * hundredth tap up to half a minute after you made it, which reads as her not having noticed.
   */
  const readMeRef = useRef<() => void>(() => {});

  /** The last greeting handed to the host, so a poll cannot re-deliver one she already said. */
  const lastGreeting = useRef<string | null>(null);

  useEffect(() => {
    deviceRef.current = deviceId();
    setDevice(deviceRef.current);
    setWallet(walletId());
    ref.current = new URLSearchParams(location.search).get('ref') || '';
    /*
     * Taps this browser counted and never got accepted, carried from a previous visit. Read ONCE
     * and erased immediately: the value is re-written on the next unmount, and a key that survived
     * a restore would be restored again after any crash that skipped the unmount — turning a
     * recovery into an inflation of the number this product promises is real.
     */
    const carried = carriedTaps(readLocal(UNSENT_KEY));
    removeLocal(UNSENT_KEY);
    if (carried > 0) pending.current += carried;
    setReady(true);
  }, []);

  const throttledNow = useCallback(() => Date.now() < backoffUntil.current, []);
  const backOff = useCallback((ms: number) => {
    backoffUntil.current = Math.max(backoffUntil.current, Date.now() + ms);
  }, []);

  const tap = useCallback(() => {
    pending.current += 1;
    /*
     * THE COUNT IS KEPT IN A REF AS WELL, and the milestone check reads THAT.
     *
     * The obvious spellings are both wrong. Reading `taps` from the closure gives the value
     * captured at render, so a fast tapper crosses 100 between paints and never triggers. Doing the
     * check inside the setTaps updater sees the right number but puts a NETWORK CALL inside a
     * function React requires to be pure — it may re-invoke an updater (concurrent rendering, and
     * StrictMode double-invokes it by design), which fires the read twice. That the app currently
     * sets `reactStrictMode: false` in next.config.js is not a defence; it is one config flip away
     * from being a duplicated request per milestone.
     *
     * A ref incremented synchronously here is exact and pure in both directions.
     */
    const before = tapCount.current;
    const next = before + 1;
    tapCount.current = next;
    setTaps(next);
    setAwake(nextAwake);
    setGlobal((g) => (g === null ? g : g + 1));
    // Crossing a milestone is the one moment the server has a new line for this player (see
    // GREETING_MILESTONES), so it is read now rather than up to 30s later on the poll.
    if (crossedMilestone(before, next)) readMeRef.current();
  }, []);

  useEffect(() => {
    writeLocal(LOCAL_KEY, JSON.stringify({ taps, awake }));
  }, [taps, awake]);

  // Idle decay, but only once the player has actually started: decaying from zero before the first
  // tap would render a meter that is already falling on a screen nobody has touched.
  useEffect(() => {
    const id = setInterval(() => {
      if (live.current.taps < 5) return;
      setAwake(decayAwake);
    }, 1500);
    return () => clearInterval(id);
  }, []);

  const applyStreak = useCallback((s?: number, best?: number) => {
    if (typeof s !== 'number' || !s) return;
    setStreak({ streak: s, best: best || s });
  }, []);

  /*
   * Flush taps to /wake through the stream-kit queue. The queue drains ONE batch at a time, so two
   * /wake POSTs can never overlap and race on the once-only `?ref` attribution the way a bare
   * setInterval(fetch) could when a request outran the tick.
   */
  useEffect(() => {
    if (!ready || !API) return;
    const q = createQueue<number>({
      handlers: [
        async ({ data: n }) => {
          const sentRef = ref.current;
          const r = await fetch(API + '/wake', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            signal: apiDeadline(),
            body: JSON.stringify({
              taps: n,
              wallet: live.current.wallet || undefined,
              device: deviceRef.current,
              tz: TZ,
              ref: sentRef || undefined,
            }),
          });
          if (r.status === 429) {
            // Read the server's own wait before throwing, so the brake is set from what it asked
            // for rather than from a guess. The throw is what puts the taps back on the pile.
            const header = Number(r.headers.get('retry-after'));
            let seconds = Number.isFinite(header) && header > 0 ? header : 0;
            if (!seconds) {
              try {
                const body = (await r.json()) as { retryAfterSec?: unknown };
                const b = Number(body?.retryAfterSec);
                if (Number.isFinite(b) && b > 0) seconds = b;
              } catch {
                /* no readable body — the floor in backoffMsFor applies */
              }
            }
            backOff(backoffMsFor(seconds));
            throw new Error('/wake throttled');
          }
          // Throw so the queue's `error` event runs and the taps (and the ref) survive.
          if (!r.ok) throw new Error('/wake answered HTTP ' + r.status);
          const j = (await r.json()) as { globalWakes?: number; streak?: number; bestStreak?: number };
          // The api has now seen this ref exactly once — attributed or rejected, it is spent.
          if (sentRef) ref.current = '';
          if (typeof j.globalWakes === 'number') setGlobal(j.globalWakes);
          applyStreak(j.streak, j.bestStreak);
        },
      ],
    });
    q.on('error', (n) => {
      pending.current += n as number;
    });
    const id = setInterval(() => {
      // Nothing is sent while the server has asked us to wait — the taps keep accumulating and go
      // out in one batch when the window expires, which is also fewer requests.
      if (throttledNow() || pending.current <= 0) return;
      const n = Math.min(WAKE_BATCH, pending.current);
      pending.current -= n;
      q.enqueue(n);
    }, 2000);
    return () => {
      clearInterval(id);
      /*
       * Anything still queued was taken off `pending`, so put it back before the queue is dropped.
       * What is NOT recoverable is a batch already in flight: it is neither in the queue nor in
       * `pending`, and the server may well have accepted it — restoring that one would double-count
       * it, which is the wrong direction to be wrong on this number.
       */
      for (const n of q.clear()) pending.current += n;
      if (pending.current > 0) writeLocal(UNSENT_KEY, String(Math.min(MAX_CARRIED_TAPS, pending.current)));
    };
  }, [ready, applyStreak, throttledNow, backOff]);

  /*
   * The global counter and her greeting. Both are reads, both honour the shared brake, and neither
   * ever substitutes a local guess for a server number: the counter stays null until a real value
   * lands, because a seeded number that later collapses is worse than a dash.
   */
  useEffect(() => {
    if (!ready || !API) return;
    let alive = true;

    const readStats = async () => {
      if (throttledNow()) return;
      const r = await readJson<{ globalWakes?: number }>(API + '/stats');
      if (!alive) return;
      if (r.ok && typeof r.data.globalWakes === 'number') setGlobal(r.data.globalWakes);
      else if (!r.ok && r.throttled) backOff(r.retryAfterMs);
    };

    const readMe = async () => {
      if (throttledNow()) return;
      // questId, not a second copy of the same ternary: /game builds its /me and /quests ids with
      // it, and two spellings of 'who is this player' drift into two different players.
      const id = questId(live.current.wallet, deviceRef.current);
      const r = await readJson<{ streak?: number; bestStreak?: number; greeting?: string; taps?: number; level?: WakeLevel }>(`${API}/me?${id}`);
      if (!alive) return;
      if (!r.ok) {
        if (r.throttled) backOff(r.retryAfterMs);
        return;
      }
      const j = r.data;
      applyStreak(j.streak, j.bestStreak);
      if (j.level) setLevel(j.level);
      /*
       * DELIVERED ONLY WHEN IT CHANGES, and this is not a nicety.
       *
       * /me is polled on a timer, and it returns a greeting every time. On /game that was harmless
       * — it set a line. On the avatar screen the greeting is SPOKEN, so delivering it on every
       * poll makes her talk to herself twice a minute, unprompted, forever, with a TTS request
       * behind each one. Routing this to speech turned a harmless repeat into a bill and a tic.
       *
       * Text is the right key: greetingFor picks from a fixed pool with a seed derived from taps
       * and streak, so within a tier the same sentence comes back every time, and it changes
       * exactly when the player's standing does — which is the only moment worth saying it again.
       */
      const greeting = j.greeting;
      const worthSaying = greeting && ((j.taps ?? 0) > 0 || (j.bestStreak ?? 0) > 0);
      if (worthSaying && greeting !== lastGreeting.current) {
        lastGreeting.current = greeting;
        greetingRef.current?.(greeting);
      }
    };

    readMeRef.current = () => { void readMe(); };
    void readStats();
    void readMe();
    const id = setInterval(() => {
      void readStats();
      void readMe();
    }, meEveryMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [ready, applyStreak, throttledNow, backOff, meEveryMs]);

  return { configured: Boolean(API), ready, taps, awake, global, streak, level, mood: moodFor(awake), tap, throttledNow, backOff, device, wallet, setWallet };
}
