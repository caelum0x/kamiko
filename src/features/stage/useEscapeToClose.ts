/**
 * useEscapeToClose.ts — Escape dismisses whatever is floating over her.
 *
 * WHY IT IS ONE HOOK. Four things mount over the avatar — the about panel, the tap panel, the emote
 * tray and the backdrop picker — and only two of them listened for Escape. The trays did not, so
 * the stage answered the same key differently depending on which button you had last pressed, and
 * a tray opened by accident on a keyboard could only be closed by finding its × with a mouse. On a
 * screen whose entire point is what is BEHIND the panels, "dismiss this" has to be one gesture.
 *
 * TWO THINGS IN HERE ARE LOAD-BEARING, both learned from the about panel's bugs:
 *
 *   THE CALLBACK IS READ OFF A REF. Every host passes an inline arrow (`onClose={() => setX(false)}`),
 *   so its identity changes on each of the stage's renders — and the stage re-renders on every chat
 *   message. Listing it as a dependency tears down and re-registers the listener continuously; worse,
 *   any effect fused with it (focus, in the about panel's case) re-runs too. Reading the current
 *   callback through a ref means the effect depends on `active` alone and the handler still calls the
 *   LATEST closure rather than one captured three renders ago.
 *
 *   IT STOPS LISTENING WHEN INACTIVE. The listener is on `window`. A panel that is hidden rather than
 *   unmounted — the about panel is exactly that, because its prose has to stay in the DOM — would
 *   otherwise keep swallowing every Escape for the rest of the session, including the one meant for
 *   the panel that IS open.
 */
import { useEffect, useRef } from 'react';

/**
 * Call `onClose` when Escape is pressed, while `active`.
 *
 * @param onClose may be a fresh function on every render; the latest one is always the one called.
 * @param active pass `false` for a panel that stays mounted while closed. Components that unmount
 *        when dismissed can leave it at its default.
 */
export function useEscapeToClose(onClose: () => void, active: boolean = true): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}
