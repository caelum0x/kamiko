/**
 * overlays.ts — which panels may be on the stage at the same time.
 *
 * THE BUG THIS FIXES, and it is the exact bug that was reported about the old about-card: two dark
 * panels stacked on top of each other over the avatar.
 *
 * Four things can float over her, and their geometry only works because they are in different parts
 * of the screen:
 *
 *   about      fixed left-12 top-2,   w min(21rem, 100vw-4rem)   — a reading column, near full height
 *   tap        fixed bottom-20 right-4, w-64, max-h 70vh         — the clicker and its dashboard
 *   emotes     fixed right-2 top-20,  w-[8.5rem]                 — a tray
 *   backdrops  fixed right-2 top-20,  w-[8.5rem]                 — a tray, stacked under emotes
 *
 * On a desktop viewport that is true: at 1440px the about column ends at 384px and the tap panel
 * starts at 1180px. On a 390px PHONE it is false and every one of those numbers overlaps. The about
 * column alone spans 48-374px of a 390px screen, which is the whole stage — so opening the clicker
 * behind it produces the stacked-cards mess, and a screenshot at 390px is what proved it rather than
 * an opinion about it.
 *
 * THE RULE, therefore: the two big panels are exclusive with each other and with the trays; the two
 * TRAYS are not exclusive with each other, because they are deliberately designed to stack — the
 * host renders them into one right-hand column (`flex flex-col items-end gap-2`) and reaching for an
 * emote while choosing a backdrop is a real thing to want.
 *
 * It lives here, pure, rather than as four inline `setShowX(false)` calls in the menu's click
 * handlers, for the same reason background.ts does: a rule spread across four call sites is a rule
 * with four chances to be half-applied, and this one cannot be tested at all through a component
 * that mounts three.js.
 */

/** The panels that can float over the avatar. */
export interface StageOverlays {
  /** "what is this?" — the page's prose, in a column off the menu rail. */
  about: boolean;
  /** "tap to wake her" — the clicker and the whole funnel dashboard. */
  tap: boolean;
  /** The emote tray. */
  emotes: boolean;
  /** The backdrop picker. */
  backdrops: boolean;
}

export type StageOverlay = keyof StageOverlays;

export const NO_OVERLAYS: StageOverlays = { about: false, tap: false, emotes: false, backdrops: false };

/**
 * What may stay open alongside each overlay when it OPENS. Everything not listed closes.
 *
 * Written as "what survives" rather than "what to close" on purpose: the failure mode is forgetting
 * to close a NEW panel somebody adds later, and a list of survivors fails closed — an overlay nobody
 * thought about is simply dismissed, which is never the stacked-cards bug.
 */
const COEXISTS_WITH: Record<StageOverlay, readonly StageOverlay[]> = {
  about: [],
  tap: [],
  emotes: ['backdrops'],
  backdrops: ['emotes'],
};

/**
 * PURE. Toggle one overlay and return the whole next state.
 *
 * Opening one closes everything that cannot share the screen with it. CLOSING one closes only
 * itself — it must never reach over and dismiss a panel the visitor did not touch.
 */
export function toggleStageOverlay(state: StageOverlays, which: StageOverlay): StageOverlays {
  if (state[which]) return { ...state, [which]: false };

  const survives = COEXISTS_WITH[which];
  const next = { ...NO_OVERLAYS };
  for (const key of survives) next[key] = state[key];
  next[which] = true;
  return next;
}

/** PURE. Close one overlay by name, leaving the others exactly as they are (the × on each panel). */
export function closeStageOverlay(state: StageOverlays, which: StageOverlay): StageOverlays {
  return { ...state, [which]: false };
}
