/**
 * useNpcBoard.ts — the funnel dashboard reads, headless, so they can render anywhere.
 *
 * WHY THIS EXISTS.
 * The clicker's dashboard — the leaderboard, the quest board and the verified-contract CTA — lived
 * inside game.tsx's render, so reaching it meant NAVIGATING AWAY from the avatar. The tap loop
 * moved onto the front page (src/npc/useWakeTaps.ts) and then had a button that pushed to /game,
 * which is the same problem with an extra click: the one screen the product is about is the one you
 * leave to see how you are doing.
 *
 * So the reads live here and both surfaces render them in place. `/game` keeps its full-page
 * layout; the panel on the avatar screen shows the same data over the stage. One implementation,
 * because the refusals below are the honest-money rules and two copies of them drift:
 *
 *   - THE LEADERBOARD SHOWS REAL PLAYERS OR NOTHING. A failed read empties it rather than leaving
 *     stale names on screen; a THROTTLE changes nothing, because "we asked too fast" is not a
 *     statement about who is winning.
 *   - THE CTA IS WRITTEN BY THE VERIFIER OR NOT AT ALL. GET /trust is the only thing that knows the
 *     real mint. A throttle leaves the last real answer standing — the funnel must never disown its
 *     own contract because it polled too fast — and every other failure lands on `unverified`,
 *     which is the honest fail-closed state for "we could not ask".
 *
 * IT SHARES THE ONE BRAKE. `throttledNow` / `backOff` come from useWakeTaps, because every call
 * these two hooks make shares a single per-client bucket on npc-api: a throttle from any of them
 * must park all of them, or the loops race to be the one that spends the recovered budget.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { API, readJson } from './config.ts';
import { TZ, questId, sessionHeaders } from './identity.ts';
import { caLabel, ctaState, type CtaState } from './cta.ts';

export interface Quest {
  id: string;
  label: string;
  progress: number;
  goal: number;
  done: boolean;
  reward: string;
}

export interface Daily {
  label: string;
  progress: number;
  goal: number;
  done: boolean;
  reward: string;
}

export interface QuestBoard {
  list: Quest[];
  done: number;
  total: number;
  daily: Daily | null;
}

export interface NpcBoard {
  /** Top players, or null when the last read genuinely failed — never stale names. */
  rows: Array<[string, number]> | null;
  quests: QuestBoard | null;
  cta: CtaState | null;
  /** The contract line to render, already in its transient "copied ✅" state when applicable. */
  caText: string;
  /** Copy the verified mint, and say "copied" only if the clipboard actually took it. */
  copyCa: () => Promise<void>;
  /** Quest ids that completed while this session was watching — the caller decides how to celebrate. */
  justCompleted: string[];
  /**
   * Re-read the quest board NOW.
   *
   * Connecting a wallet completes the `connect` quest server-side that instant, and waiting for the
   * next poll to show it makes the reward look like it did not fire. The caller triggers this on
   * the actions it knows changed something.
   */
  refreshQuests: () => void;
}

export interface NpcBoardOptions {
  /** Shared with useWakeTaps: one throttle parks every call this client makes. */
  throttledNow: () => boolean;
  backOff: (ms: number) => void;
  /** False until identity has resolved after mount. */
  ready: boolean;
  wallet: string;
  device: string;
  boardEveryMs?: number;
  questsEveryMs?: number;
}

export function useNpcBoard(opts: NpcBoardOptions): NpcBoard {
  const { throttledNow, backOff, ready, wallet, device, boardEveryMs = 4000, questsEveryMs = 6000 } = opts;

  const [rows, setRows] = useState<Array<[string, number]> | null>(null);
  const [quests, setQuests] = useState<QuestBoard | null>(null);
  const [cta, setCta] = useState<CtaState | null>(null);
  const [caText, setCaText] = useState('CA: unverified');
  const [justCompleted, setJustCompleted] = useState<string[]>([]);

  const live = useRef({ wallet, device });
  live.current = { wallet, device };
  const seenQuests = useRef(false);
  const doneQuests = useRef(new Set<string>());

  const idFor = useCallback(() => questId(live.current.wallet, live.current.device), []);

  const drawBoard = useCallback(async () => {
    if (throttledNow()) return;
    const r = await readJson<{ leaderboard?: Array<{ wallet: string; count: number }> }>(API + '/leaderboard?limit=5');
    if (!r.ok) {
      // A throttle keeps the last real board on screen; a real failure shows nothing rather than
      // names that may no longer be true.
      if (r.throttled) { backOff(r.retryAfterMs); return; }
      setRows(null);
      return;
    }
    setRows((r.data.leaderboard || []).map((x) => [x.wallet, x.count] as [string, number]));
  }, [throttledNow, backOff]);

  const drawQuests = useCallback(async () => {
    if (throttledNow()) return;
    const r = await readJson<QuestBoard & { quests?: Quest[] }>(
      API + '/quests?' + idFor() + '&tz=' + TZ,
      { headers: sessionHeaders(live.current.wallet) },
    );
    if (!r.ok) {
      if (r.throttled) backOff(r.retryAfterMs);
      return;
    }
    const j = r.data as unknown as { quests?: Quest[]; done: number; total: number; daily?: Daily | null };
    if (!j || !Array.isArray(j.quests)) return;
    const fresh: string[] = [];
    for (const q of j.quests) {
      if (q.done && !doneQuests.current.has(q.id)) {
        // Only celebrate what completed while somebody was WATCHING. On the first read every
        // already-finished quest would otherwise fire at once, which is a burst of congratulations
        // for things the player did days ago.
        if (seenQuests.current) fresh.push(q.id);
        doneQuests.current.add(q.id);
      }
    }
    seenQuests.current = true;
    if (fresh.length) setJustCompleted(fresh);
    setQuests({ list: j.quests, done: j.done, total: j.total, daily: j.daily || null });
  }, [idFor, throttledNow, backOff]);

  useEffect(() => {
    if (!ready || !API) return;
    void drawBoard();
    void drawQuests();
    const b = setInterval(() => void drawBoard(), boardEveryMs);
    const q = setInterval(() => void drawQuests(), questsEveryMs);
    return () => { clearInterval(b); clearInterval(q); };
  }, [ready, drawBoard, drawQuests, boardEveryMs, questsEveryMs]);

  /*
   * The contract CTA. A THROTTLE IS NOT A VERDICT: GET /trust is rate-limited like every other
   * public read, and a 429 body is JSON — handing it to ctaState returns `unverified`, so the page
   * would stop showing the real, verified contract and tell visitors it could not confirm one. The
   * funnel disowning its own mint because it polled too fast is worse than showing nothing. On a
   * throttle we back off and CHANGE NOTHING; every other failure lands on `unverified`.
   */
  useEffect(() => {
    if (!API) return;
    let alive = true;
    const load = async () => {
      const r = await readJson<unknown>(API + '/trust', { headers: { accept: 'application/json' } });
      if (!alive) return;
      if (!r.ok && r.throttled) { backOff(r.retryAfterMs); return; }
      const st = ctaState(r.ok ? r.data : null);
      setCta(st);
      setCaText(caLabel(st));
    };
    void load();
    const id = setInterval(() => { if (!throttledNow()) void load(); }, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [throttledNow, backOff]);

  /**
   * Copy the verified mint, and say "copied" only when the clipboard actually took it.
   *
   * Lifted from game.tsx rather than rewritten, including the two behaviours that are easy to lose:
   * a missing clipboard API (an insecure origin, an unfocused document) is reported with the FULL
   * address so it can be selected by hand, and that message does NOT auto-revert — a line you need
   * to read and copy from must not disappear after a second and a half. "copied ✅" over a
   * clipboard that still holds something else is how somebody pastes the wrong address into a
   * wallet.
   */
  const copyCa = useCallback(async () => {
    const mint = cta?.cta ? cta.cta.mint : '';
    const short = cta?.cta ? cta.cta.short : '';
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
    setCaText('copied ✅ ' + short);
    setTimeout(() => setCaText(caLabel(cta)), 1500);
  }, [cta]);

  return { rows, quests, cta, caText, copyCa, justCompleted, refreshQuests: () => void drawQuests() };
}
