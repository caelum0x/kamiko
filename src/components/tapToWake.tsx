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
import { useWakeTaps } from '@/npc/useWakeTaps';

/** One drifting "+1" over the point that was tapped. */
interface Float {
  id: number;
  x: number;
  y: number;
}

export interface TapToWakeProps {
  /**
   * Open the full `/game` dashboard.
   *
   * THE PANEL IS NOT THE WHOLE GAME, and the button that used to reach the rest of it is now this
   * panel's toggle. Without a way forward from here, `/game` — the leaderboard, quests, the CTA,
   * the wallet handshake and the streak saver — goes back to being the direct-link-only orphan
   * index.tsx's own comment describes it having been. Somebody tapping is exactly the person who
   * wants the leaderboard.
   *
   * A callback rather than an <a href> or window.open: index.tsx routes with `router.push`, which
   * applies next.config.js's basePath. window.open takes a raw URL and does not, so on a BASE_PATH
   * deployment a hardcoded link here would 404.
   */
  openDashboard: () => void;
  /**
   * Say a line as HER: through TTS and the VRM expression, not as page text.
   *
   * Optional on purpose — the panel is still a working clicker without a speak path, and a missing
   * one must not crash the avatar screen. When it is absent the line is shown instead.
   */
  speak?: (line: string) => void;
  onClose: () => void;
}

export function TapToWake({ speak, openDashboard, onClose }: TapToWakeProps) {
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

  const { taps, awake, global, streak, tap } = useWakeTaps({ onGreeting });

  const onTap = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      tap();
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
    <div className="fixed bottom-20 right-4 z-20 w-64 rounded-2xl bg-black/70 p-4 text-white backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest opacity-70">tap to wake her</span>
        <button onClick={onClose} aria-label="close the tap panel" className="px-1 text-lg leading-none opacity-70 hover:opacity-100">
          ×
        </button>
      </div>

      {/* The wake meter. `pct` is the same 0..100 the /game dashboard shows, from the same engine. */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/20">
        <div className="h-full rounded-full bg-white transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>

      <button
        onClick={onTap}
        aria-label="tap"
        className="relative mt-3 h-20 w-full select-none overflow-hidden rounded-xl bg-white/10 text-3xl active:scale-95"
      >
        {pct < 15 ? '😐' : pct < 50 ? '😳' : pct < 85 ? '🤯' : '😈'}
        {floats.map((f) => (
          <span key={f.id} className="pointer-events-none absolute text-sm opacity-80" style={{ left: f.x, top: f.y }}>
            +1
          </span>
        ))}
      </button>

      <div className="mt-2 flex justify-between text-xs opacity-70">
        <span>you: {taps}</span>
        {/* '…' until a real number lands — never a seeded value that later collapses. */}
        <span>all: {global === null ? '…' : global.toLocaleString()}</span>
      </div>
      {streak ? <div className="mt-1 text-xs opacity-70">streak: {streak.streak}d (best {streak.best})</div> : null}

      {line ? <p className="mt-2 border-t border-white/15 pt-2 text-xs italic opacity-80">{line}</p> : null}

      {/* The way forward. See `openDashboard` above for why this is a callback and not a link. */}
      <button
        onClick={openDashboard}
        className="mt-3 w-full rounded-lg border border-white/20 py-1.5 text-xs opacity-80 hover:opacity-100"
      >
        leaderboard, quests &amp; rewards →
      </button>
    </div>
  );
}

export default TapToWake;
