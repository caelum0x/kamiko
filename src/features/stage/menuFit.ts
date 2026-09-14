/**
 * menuFit.ts — the menu rail has to fit on the screen it is drawn on.
 *
 * THE BUG, measured rather than guessed. The rail is a single vertical column of 28px icons with
 * 12px between them, and it has grown every time the stage gained a feature: about, settings, chat
 * log, mute, webcam, tap-to-wake, emotes, backdrops, holder, trust, agents, plus the chat-mode
 * switch — twelve items, fourteen with `?dev=1`. That is 480px of column before any margins, and it
 * had NO height limit and NO scroll.
 *
 *   iPhone 12 held sideways     844 x 390  →  ~330px of usable height. The rail needs 496px.
 *   iPhone SE upright, ?dev=1   375 x 667  →  ~555px usable. The rail needs 576px.
 *   A half-height desktop window                    — same story, and this is how people watch.
 *
 * The items that fell off the bottom were, in order: backdrops, holder dashboard, trust, agents.
 * The two at the very end are the money surface and the page somebody opens to verify the mint
 * before buying — so the rail's failure mode was hiding exactly the things the funnel exists for,
 * on exactly the devices most visitors arrive on.
 *
 * It was not even a clean clipping. The rail was `absolute`, so the overflow EXTENDED THE DOCUMENT:
 * the stage page grew a scrollbar, and scrolling it moved the rail against an avatar that stayed
 * put (VrmViewer is fixed), which looks like the page is coming apart. `fixed` plus an internal
 * cap keeps the document exactly one screen tall, which is what a stage should be.
 *
 * WHY A MODULE AND NOT FOUR CLASSES IN THE JSX: index.tsx pulls in three.js and cannot be mounted
 * in jsdom, so anything asserted about it has to be asserted here. The heights are the numbers the
 * Tailwind classes actually compile to, named beside the class they come from, so a later `space-y`
 * change has one place to be reflected.
 */

/** `h-7` — the icon in a MenuButton, and therefore the button's height. */
export const MENU_ITEM_PX = 28;
/** `h-14` — the same button in VR, where everything is twice the size. */
export const MENU_ITEM_VR_PX = 56;
/** `space-y-3` between the column's children. */
export const MENU_GAP_PX = 12;
/** `p-1` on the column, top and bottom. */
export const MENU_PAD_PX = 4;
/** `m-2` on the rail + `mt-2` on the glass — the offset above the column, doubled for a bottom gap. */
export const MENU_OFFSET_PX = 8;
/** `h-8` — the vertical chat-mode switch that ends the column. Its label is empty, so it adds nothing. */
export const MENU_SWITCH_PX = 32;

export interface RailShape {
  /** How many MenuButtons are rendered. `?dev=1` adds two. */
  buttons: number;
  /** VR headset sizing (`large`), which doubles every icon. */
  large?: boolean;
  /** Whether the chat-mode switch is on the end of the column. */
  hasSwitch?: boolean;
}

/**
 * PURE. How tall the rail's column wants to be, in CSS pixels, before any cap is applied.
 *
 * Includes the column's own padding but NOT the margins around it — see `railFitsIn`, which is the
 * function that has to know about the space above and below.
 */
export function railHeightPx({ buttons, large = false, hasSwitch = true }: RailShape): number {
  const items = Math.max(0, buttons) + (hasSwitch ? 1 : 0);
  if (items === 0) return MENU_PAD_PX * 2;
  const itemPx = large ? MENU_ITEM_VR_PX : MENU_ITEM_PX;
  const buttonsPx = Math.max(0, buttons) * itemPx + (hasSwitch ? MENU_SWITCH_PX : 0);
  return MENU_PAD_PX * 2 + buttonsPx + (items - 1) * MENU_GAP_PX;
}

/**
 * PURE. Does the uncapped rail fit in a viewport this tall?
 *
 * `MENU_OFFSET_PX * 2` is the margin above it and the matching breathing room below — a rail whose
 * last icon is flush against the bottom edge of a phone is inside the home-indicator strip, where
 * the OS eats the tap.
 */
export function railFitsIn(viewportPx: number, shape: RailShape): boolean {
  return railHeightPx(shape) + MENU_OFFSET_PX * 2 <= viewportPx;
}

/**
 * The rail's anchor.
 *
 * `fixed`, not `absolute`: see the header — an absolutely positioned overflow adds height to the
 * document and makes the whole stage page scroll behind a fixed avatar. `left-0 top-0` is spelled
 * out because a `fixed` box with no insets falls back to its static position in the flow, which
 * depends on what happens to sit above it in index.tsx's JSX — a dependency nobody wants.
 */
export const RAIL_ANCHOR_CLASS = 'fixed left-0 top-0 z-10 m-2';

/**
 * The column inside the glass: capped to the viewport, and scrollable when it does not fit.
 *
 * `100dvh`, not `100vh`, for the reason the about panel uses it — on iOS `100vh` is the height with
 * the browser chrome retracted, so the last item sits under the toolbar exactly when the toolbar is
 * showing. `1.5rem` is the 8px margin above plus the 8px gap below plus 8px of slack.
 *
 * `justify-start`, NOT the `justify-center` this column used to carry, and that is a real bug and
 * not a preference: a flex container that centres its children and then overflows pushes the first
 * child to a NEGATIVE offset, and a scroll container cannot be scrolled above its own origin. The
 * top of a centred, overflowing column is simply unreachable in every browser. Centring only ever
 * mattered when the column was short — which is precisely when there is nothing to centre against.
 *
 * The scrollbar is left visible, the same bargain the emote tray and the tap panel already make on
 * this stage: it is the only thing that tells somebody there are more controls below the fold.
 */
export const RAIL_COLUMN_CLASS =
  'flex max-h-[calc(100dvh-1.5rem)] flex-col items-center justify-start overflow-y-auto overscroll-contain p-1 space-y-3';
