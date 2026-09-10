/**
 * tapToWake.tsx — the clicker, on the screen she is actually on.
 *
 * WHY THIS COMPONENT EXISTS.
 * "Tap to wake her" lived on `/game`, a route that renders no avatar (game.tsx imports no
 * VrmViewer) and whose idea of her voice is three hardcoded string pools picked at random. The
 * retention loop therefore showed neither her face nor her brain, and the menu button for it
 * navigated AWAY from the one thing the product is. Tapping woke a counter.
 *
 * Mounted on `/`, the same taps go to the same npc-api through the same bridge — the engine is
 * shared, not copied (src/npc/useWakeTaps.ts) — and her line is spoken by the real pipeline:
 * textsToScreenplay parses the emotion tag the bridge injects, and chat.ttsJobs carries it through
 * TTS to viewer.model.speak, which is what moves her face. That is the difference between a
 * counter and waking her.
 *
 * IT DOES NOT DUPLICATE THE DASHBOARD. The leaderboard, quests, the CTA, the wallet handshake and
 * the streak-saver offer stay on `/game`, which remains the full funnel surface. This is the tap
 * loop and nothing else, so the avatar keeps the screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWakeTaps, type WakeMood } from '@/npc/useWakeTaps';
import { useNpcBoard } from '@/npc/useNpcBoard';
import { useWalletLink } from '@/npc/useWalletLink';
import { shortAddr } from '@/npc/identity';
import { API, readJson } from '@/npc/config';

/**
 * The NVDAX quote mint she is paired against — the "NVIDIA" xStock on Solana (Token-2022).
 * NVDAX is a tokenized tracker, NOT NVIDIA stock; holders own no NVDA. The Solscan page is the
 * only claim made here, and it is a link anyone can verify.
 */
const NVDAX_MINT = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh';
const NVDAX_SOLSCAN = `https://solscan.io/token/${NVDAX_MINT}`;

/** The shape of the bits of GET /market this HUD reads. Every field is optional — a partial or
 *  missing payload must render as a blank, never a crash. */
interface MarketQuote {
  symbol?: string;
  priceUsd?: number | null;
  change24h?: number | null;
  source?: string;
}
interface TokenTape {
  priceUsd?: number | null;
  change24h?: number | null;
  /** Bonding-curve progress 0→1 from Raydium LaunchLab (finishingRate) — how close to graduation. */
  finishingRate?: number | null;
  live?: boolean;
}
interface MarketResp {
  quote?: MarketQuote | null;
  tokenTape?: TokenTape | null;
}

/** PURE. Format a USD price, with more decimals for sub-dollar meme prices. `—` when absent. */
export function fmtUsd(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const digits = Math.abs(n) < 1 ? 6 : 2;
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: digits });
}
/** PURE. Signed 24h percent, or '' when there is no number to sign. */
export function fmtPct(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}
/** PURE. Green up, red down, dim when unknown — no emoji, just colour. */
export function pctClass(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'opacity-60';
  return n >= 0 ? 'text-emerald-400' : 'text-rose-400';
}

/**
 * PURE. Bonding-curve graduation, 0–100, or null when there is nothing honest to show.
 *
 * Extracted out of the JSX so it can be tested: this is a percentage rendered next to a token's
 * name, and the failure modes are all silent ones. `finishingRate` is Raydium LaunchLab's 0→1
 * reading of how close $KAMIKO is to graduating off the curve, and it arrives over the network —
 * so it can be absent, null, a string, NaN, or out of range, and every one of those must become
 * "say nothing" or a clamped number rather than `NaN%` or a bar past its own track.
 *
 * It is null unless the token is LIVE: before launch there is no curve, and a graduation reading
 * for a token that does not exist is the kind of number somebody screenshots.
 */
export function graduationPercent(tape: { live?: boolean; finishingRate?: unknown } | null | undefined): number | null {
  if (!tape?.live) return null;
  const raw = tape.finishingRate;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.round(Math.min(1, Math.max(0, raw)) * 100);
}

export interface MarketHudProps {
  /** Open the Solscan link the host's way — same reason TapToWake takes one: only the host knows
   *  how a link leaves this origin (new tab, noopener, BASE_PATH). */
  openLink?: (url: string) => void;
}

/**
 * MarketHud — the two-ticker HUD, on the stage she actually lives on.
 *
 * She woke up inside NVIDIA and lives on NVDAX: this chip shows the tape she reacts to — the NVDAX
 * quote she is paired against, and her own $KAMIKO token once it is live. It is a passenger on the
 * avatar screen, so it FAILS SILENTLY: a slow 60s poll, last-good numbers left standing on a
 * throttle or a failed read, and nothing thrown at the stage. It hides entirely until the first
 * read lands, so an unreachable bridge shows nothing rather than a permanent row of dashes.
 *
 * Mobile-safe at 390px: pinned top-right (the menu is top-left, the chat input is at the bottom),
 * compact, and wraps rather than pushing width.
 */
export function MarketHud({ openLink }: MarketHudProps) {
  const [quote, setQuote] = useState<MarketQuote | null>(null);
  const [tape, setTape] = useState<TokenTape | null>(null);

  useEffect(() => {
    if (!API) return; // no funnel API configured — nothing to show, stay hidden.
    let alive = true;
    const load = async () => {
      const r = await readJson<MarketResp>(API + '/market');
      if (!alive) return;
      // A throttle (429) or any failure keeps the last-good numbers up — readJson honours the
      // rate limiter for us, and the next 60s tick retries. Never blank the tape, never throw.
      if (!r.ok) return;
      if (r.data?.quote) setQuote(r.data.quote);
      if (r.data?.tokenTape) setTape(r.data.tokenTape);
    };
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Hide until something real lands, so an unreachable bridge is silent, not a dashes-only chip.
  if (!quote && !tape) return null;

  const kamikoLive = !!tape?.live;
  const gradPct = graduationPercent(tape);

  return (
    <div className="pointer-events-auto fixed right-2 top-2 z-20 flex max-w-[52vw] flex-col items-end gap-0.5 rounded-xl bg-black/70 px-3 py-2 text-white backdrop-blur-sm sm:max-w-none">
      <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-[11px] leading-tight tabular-nums">
        <span className="opacity-80">
          NVDAX <span className="opacity-100">{fmtUsd(quote?.priceUsd)}</span>{' '}
          <span className={pctClass(quote?.change24h)}>{fmtPct(quote?.change24h)}</span>
        </span>
        <span aria-hidden className="opacity-30">
          ·
        </span>
        <span className="opacity-80">
          $KAMIKO{' '}
          {kamikoLive ? (
            <>
              <span className="opacity-100">{fmtUsd(tape?.priceUsd)}</span>{' '}
              <span className={pctClass(tape?.change24h)}>{fmtPct(tape?.change24h)}</span>
            </>
          ) : (
            <span className="opacity-60">not live yet</span>
          )}
        </span>
      </div>
      {/*
        GRADUATION — the real bonding-curve progress once $KAMIKO is live. finishingRate is the
        Raydium LaunchLab reading of how close the token is to graduating off the curve; a thin bar
        plus the percent makes that legible without adding width. Only shown when live and a real
        0→1 number landed, so a pre-launch or missing reading stays silent.
      */}
      {gradPct !== null ? (
        <div
          className="flex w-24 items-center gap-1.5 text-[9px] uppercase tracking-wider tabular-nums opacity-70"
          title="$KAMIKO bonding-curve progress toward graduating off the Raydium LaunchLab curve"
        >
          <span className="shrink-0">grad {gradPct}%</span>
          <div
            role="progressbar"
            aria-label="$KAMIKO bonding-curve graduation progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={gradPct}
            className="h-1 flex-1 overflow-hidden rounded-full bg-white/20"
          >
            <div className="h-full rounded-full bg-emerald-400" style={{ width: `${gradPct}%` }} />
          </div>
        </div>
      ) : null}
      <button
        onClick={() => openLink?.(NVDAX_SOLSCAN)}
        title="NVDAX is a tokenized tracker, not NVIDIA stock — holders own no NVDA. View the mint on Solscan."
        aria-label="paired with NVDAX — view the NVDAX quote mint on Solscan"
        className="text-[10px] uppercase tracking-wider opacity-50 hover:underline hover:opacity-90"
      >
        paired with NVDAX · solscan
      </button>
    </div>
  );
}

/** One drifting "+1" over the point that was tapped. */
interface Float {
  id: number;
  x: number;
  y: number;
}

export interface TapToWakeProps {
  /**
   * Open the token's buy/chart link in a new tab.
   *
   * A callback rather than an <a href> for the same reason the panel does not navigate at all: the
   * host page decides how a link leaves this origin, and it is the only place that knows whether a
   * BASE_PATH applies.
   */
  openLink?: (url: string) => void;
  /**
   * Put her FACE in a mood, with no audio.
   *
   * This is what makes waking her legible instead of numeric: without it, tapping moved a bar and
   * she sat there neutral. Optional like `speak` — the panel is a working clicker on a page with no
   * avatar, and a missing viewer must never crash the stage.
   */
  setMood?: (mood: WakeMood) => void;
  /**
   * Called on EVERY tap, before anything else.
   *
   * This is the signal that makes the game's verb true. The avatar's wakefulness is owned by
   * amicaLife and chat.lastAwake, not by this meter — so without this the player taps, the bar
   * fills, and the system that decides whether she idles, animates and speaks on her own has heard
   * nothing. Separate from `setMood` because it must fire on every tap, not only when the meter
   * crosses a band.
   */
  onTap?: () => void;
  /**
   * Say a line as HER: through TTS and the VRM expression, not as page text.
   *
   * Optional on purpose — the panel is still a working clicker without a speak path, and a missing
   * one must not crash the avatar screen. When it is absent the line is shown instead.
   */
  speak?: (line: string) => void;
  onClose: () => void;
}

export function TapToWake({ speak, setMood, onTap: onTapSignal, openLink, onClose }: TapToWakeProps) {
  const [line, setLine] = useState<string | null>(null);
  const [floats, setFloats] = useState<Float[]>([]);
  const seq = useRef(0);

  /**
   * Her greeting comes from the SERVER (/me), written by her brain — not from a local pool. It is
   * routed to `speak` when there is one, so the avatar delivers it, and kept on screen as a caption
   * either way.
   *
   * Held in a ref and read through a stable callback: passing a fresh closure into the engine on
   * every render would re-arm its poll effect, and the greeting would arrive on a loop.
   */
  const speakRef = useRef(speak);
  speakRef.current = speak;
  const onGreeting = useCallback((text: string) => {
    setLine(text);
    speakRef.current?.(text);
  }, []);

  const engine = useWakeTaps({ onGreeting });
  const { configured, taps, awake, global, streak, level, mood, tap, ready, throttledNow, backOff, wallet, setWallet, device } = engine;

  /*
   * THE DASHBOARD IS HERE, NOT ONE NAVIGATION AWAY.
   *
   * This panel used to end in a "leaderboard, quests & rewards →" button that pushed to /game —
   * which is the problem the panel was built to solve, with an extra click in front of it. The
   * avatar is the product; leaving her to find out how you are doing is the thing worth not doing.
   * The reads are shared with /game (src/npc/useNpcBoard.ts) rather than copied, and they take THIS
   * hook's throttle brake, because every call both hooks make comes out of one per-client bucket.
   */
  const board = useNpcBoard({ throttledNow, backOff, ready, wallet, device });

  /*
   * THE WALLET AND THE STREAK SAVER, so this is the whole funnel and not most of it.
   *
   * Without these the panel shows a leaderboard the player has no way to claim their place on, and
   * a streak with no way to be reminded of it — the revenue and retention halves left behind on a
   * page nothing links to any more. Shared with /game (src/npc/useWalletLink.ts), because the rule
   * that guest taps are claimed with a SESSION and never a bare public key is not a rule worth
   * having two copies of.
   */
  const { walletMsg, connect, pushOffer, pushArmed, pushMsg, armStreakSaver } =
    useWalletLink({ device, wallet, setWallet, onLinked: board.refreshQuests });

  /**
   * Drive her expression from the meter — ONLY WHEN IT CHANGES.
   *
   * playEmotion restarts the emote controller and the procedural idle mood, so calling it on every
   * tap would retrigger the animation dozens of times a second and she would twitch rather than
   * wake. The effect's dependency is the mood, not `awake`, which is what makes that true.
   */
  const setMoodRef = useRef(setMood);
  setMoodRef.current = setMood;
  useEffect(() => {
    setMoodRef.current?.(mood);
  }, [mood]);

  /*
   * THE PANEL WRITES NOTHING ON THE WAY OUT, and the first version of this was a bug.
   *
   * It used to reset her to 'neutral' on unmount, reasoning that leaving her stuck mid-'happy' is
   * an expression nothing on screen explains. But `setMood` is the WAKING path — index.tsx ends
   * amicaLife's sleep for any mood that is not 'Sleep' — so closing the panel woke her up. Open it,
   * close it without tapping once, and she is out of the sleep the idle timer had put her in.
   *
   * There is nothing to clean up anyway: amicaLife and the chat both write her face, and amicaLife
   * sleeps her on idle regardless. The panel is a guest on the stage; it does not get an opinion
   * about her once it is gone.
   */

  const tapSignalRef = useRef(onTapSignal);
  tapSignalRef.current = onTapSignal;

  /*
   * A COMPLETED QUEST IS FELT HERE TOO.
   *
   * useNpcBoard reports what finished while somebody was watching, and /game floats a "✨ QUEST
   * DONE" for it. The panel was rendering the quest LIST and nothing else, so on the avatar screen
   * — the one the player is actually on — a reward fired silently: the row just quietly turned
   * into a tick. She says it instead, which is the whole reason the game moved onto her screen.
   */
  useEffect(() => {
    if (!board.justCompleted.length) return;
    const done = board.quests?.list.find((q) => q.id === board.justCompleted[0]);
    const label = done?.label ?? 'a quest';
    setLine(`✨ ${label} — done.`);
    speakRef.current?.(`${label}. done.`);
  }, [board.justCompleted, board.quests]);

  const onTap = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      tap();
      tapSignalRef.current?.();
      const rect = e.currentTarget.getBoundingClientRect();
      const id = ++seq.current;
      setFloats((f) => [...f, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
      setTimeout(() => setFloats((f) => f.filter((z) => z.id !== id)), 900);
    },
    [tap],
  );

  // Escape closes it. A panel that overlays the avatar and can only be dismissed with the mouse is
  // one people leave open by accident on the screen whose whole point is what is behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pct = Math.round(awake);

  return (
    /*
      BOUNDED AND SCROLLABLE. The panel grew from a tap surface into the whole dashboard —
      leaderboard, quests, level, contract — and it is anchored at the bottom, so it grows UPWARD.
      Without a ceiling it runs off the top of a laptop viewport and the contract line, which is the
      part that matters most, is the part that goes off screen. 70vh keeps the stage visible behind
      it, which is the entire reason the game is here instead of on /game.
    */
    <div
      role="dialog"
      aria-label="tap to wake her — the $NPC clicker"
      className="fixed bottom-20 right-4 z-20 flex max-h-[70vh] w-64 flex-col overflow-y-auto overscroll-contain rounded-2xl bg-black/70 p-4 text-white backdrop-blur-sm"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest opacity-70">tap to wake her</span>
        <button onClick={onClose} aria-label="close the tap panel" className="px-1 text-lg leading-none opacity-70 hover:opacity-100">
          ×
        </button>
      </div>

      {/* The wake meter. `pct` is the same 0..100 the /game dashboard shows, from the same engine. */}
      <div
        role="progressbar"
        aria-label="how awake she is"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mt-3 h-2 w-full shrink-0 overflow-hidden rounded-full bg-white/20"
      >
        <div className="h-full rounded-full bg-white transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>

      <button
        onClick={onTap}
        aria-label={`tap to wake her — ${pct}% awake, ${taps} taps`}
        className="relative mt-3 h-20 w-full select-none overflow-hidden rounded-xl bg-white/10 text-3xl active:scale-95"
      >
        {pct < 15 ? '😐' : pct < 50 ? '😳' : pct < 85 ? '🤯' : '😈'}
        {floats.map((f) => (
          <span key={f.id} className="pointer-events-none absolute text-sm opacity-80" style={{ left: f.x, top: f.y }}>
            +1
          </span>
        ))}
      </button>

      {/*
        SAY SO WHEN THE TAPS GO NOWHERE. Without this the panel is indistinguishable from a working
        one: the counter climbs, the meter fills and her face still changes, because all three are
        local. /holder and /trust already report an unset NEXT_PUBLIC_NPC_API; the clicker counted
        into the void on both of its surfaces.
      */}
      {!configured ? (
        <p className="mt-2 rounded-lg bg-amber-500/20 p-2 text-[11px] leading-snug">
          this build has no funnel API configured (NEXT_PUBLIC_NPC_API), so these taps are counted
          on your device only — nothing reaches the leaderboard, the streak or her memory.
        </p>
      ) : null}

      <div className="mt-2 flex justify-between text-xs opacity-70">
        <span>you: {taps}</span>
        {/* '…' until a real number lands — never a seeded value that later collapses. */}
        <span>all: {global === null ? '…' : global.toLocaleString()}</span>
      </div>
      {streak ? <div className="mt-1 text-xs opacity-70">streak: {streak.streak}d (best {streak.best})</div> : null}

      {/* aria-live: her line is the panel's only narrative output, and it changes on its own. */}
      <p aria-live="polite" className={'mt-2 border-t border-white/15 pt-2 text-xs italic opacity-80' + (line ? '' : ' sr-only')}>
        {line ?? ''}
      </p>

      {/* ── THE DASHBOARD, IN PLACE ────────────────────────────────────────────────────────── */}

      {/*
        LEADERBOARD — real players or nothing. `rows === null` is a failed read, and it renders as a
        refusal rather than as an empty board, because "nobody is playing" and "we could not ask"
        are different statements and only one of them is ever true here.
      */}
      <div className="mt-3 border-t border-white/15 pt-2">
        <div className="text-[10px] uppercase tracking-widest opacity-60">leaderboard</div>
        {board.rows === null ? (
          <p className="mt-1 text-[11px] opacity-60">could not reach the board — showing nothing rather than names that may be stale.</p>
        ) : board.rows.length === 0 ? (
          <p className="mt-1 text-[11px] opacity-60">nobody has tapped yet. be first.</p>
        ) : (
          <ol className="mt-1 space-y-0.5 text-[11px]">
            {board.rows.map(([w, n], i) => (
              <li key={w} className="flex justify-between gap-2">
                <span className="truncate opacity-80">{i + 1}. {shortAddr(w)}</span>
                <span className="tabular-nums opacity-60">{n.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* QUESTS */}
      {board.quests ? (
        <div className="mt-3 border-t border-white/15 pt-2">
          <div className="flex justify-between text-[10px] uppercase tracking-widest opacity-60">
            <span>quests</span>
            <span>{board.quests.done}/{board.quests.total}</span>
          </div>
          <ul className="mt-1 space-y-0.5 text-[11px]">
            {board.quests.list.slice(0, 4).map((q) => (
              <li key={q.id} className="flex justify-between gap-2">
                <span className={'truncate ' + (q.done ? 'opacity-50 line-through' : 'opacity-85')}>{q.label}</span>
                <span className="tabular-nums opacity-60">{q.done ? '✅' : `${q.progress}/${q.goal}`}</span>
              </li>
            ))}
          </ul>
          {board.quests.daily ? (
            <p className="mt-1 text-[11px] opacity-70">
              today: {board.quests.daily.label} · {board.quests.daily.done ? '✅' : `${board.quests.daily.progress}/${board.quests.daily.goal}`}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* LEVEL */}
      {level ? (
        <p className="mt-2 text-[11px] opacity-70">
          lvl {level.level} · {level.title}
          {level.tapsToNext == null ? ' · max' : ` · ${level.tapsToNext.toLocaleString()} to ${level.nextTitle}`}
        </p>
      ) : null}

      {/*
        THE CONTRACT — written by the verifier or not at all. A green buy link over a token our own
        verifier failed, or never graded, is the one thing on this panel that can cost somebody
        money, so the link renders only for a `live` reading.
      */}
      <div className="mt-3 border-t border-white/15 pt-2">
        <button onClick={() => void board.copyCa()} className="w-full truncate text-left text-[11px] opacity-80 hover:opacity-100">
          {board.caText}
        </button>
        {/*
          THE LINKS SHOW WHENEVER THE VERIFIER PUBLISHED A CONTRACT — including `caution`, and that
          is deliberate rather than lax.
          This gate was `state === 'live'` at first, which looks like the careful reading and is the
          dangerous one. On a `caution` verdict cta.ts still returns the links and says why: "the
          links below are the real contract — read the trust page before you buy." Withholding them
          does not stop anybody buying; it sends them to search for the token themselves, which is
          exactly how somebody ends up on an impostor. The warning goes NEXT to the links, not
          instead of them. `unsafe`, `not-launched` and `unverified` carry no cta at all, so there
          is nothing to show and nothing to withhold.
        */}
        {board.cta?.cta ? (
          <div className="mt-1 flex gap-2">
            <button onClick={() => openLink?.(board.cta!.cta!.buy)} className="flex-1 rounded-lg bg-white/15 py-1 text-[11px] hover:bg-white/25">buy</button>
            <button onClick={() => openLink?.(board.cta!.cta!.chart)} className="flex-1 rounded-lg bg-white/10 py-1 text-[11px] hover:bg-white/20">chart</button>
          </div>
        ) : null}
        {board.cta && board.cta.state !== 'live' ? (
          <p className="mt-1 text-[11px] opacity-70"><b>{board.cta.title}</b> {board.cta.detail}</p>
        ) : null}
        {!board.cta ? (
          <p className="mt-1 text-[11px] opacity-60">no verified contract yet — beware impostors.</p>
        ) : null}
      </div>

      {/* WALLET — the only way a guest's taps become theirs. */}
      <div className="mt-3 border-t border-white/15 pt-2">
        {wallet ? (
          <p className="text-[11px] opacity-70">wallet: {shortAddr(wallet)}</p>
        ) : (
          <button onClick={() => void connect()} disabled={!configured} className="w-full rounded-lg bg-white/15 py-1.5 text-[11px] hover:bg-white/25 disabled:opacity-40">
            connect wallet &amp; claim your taps
          </button>
        )}
        {walletMsg ? <p aria-live="polite" className="mt-1 text-[11px] opacity-70">{walletMsg}</p> : null}
      </div>

      {/* STREAK SAVER — offered only where it can actually be delivered. */}
      {pushOffer ? (
        <div className="mt-2">
          <button onClick={() => void armStreakSaver()} disabled={pushArmed} className="w-full rounded-lg border border-white/20 py-1 text-[11px] opacity-80 hover:opacity-100 disabled:opacity-40">
            {pushArmed ? "streak saver armed" : "remind me before my streak lapses"}
          </button>
          {pushMsg ? <p aria-live="polite" className="mt-1 text-[11px] opacity-70">{pushMsg}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export default TapToWake;
