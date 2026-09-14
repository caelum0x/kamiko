/**
 * stageMenuFit.spec.ts — the menu rail has to fit on a phone held sideways.
 *
 * THE BUG THIS PINS. The rail is one vertical column that has grown with every feature the stage
 * gained, and it had no ceiling and no scroll. On a 390px-tall viewport the last four controls —
 * backdrops, the holder dashboard, trust, agents — were simply off the bottom of the screen, and
 * two of those are the revenue surface and the page somebody opens to verify a mint before spending
 * money. It was not clipped, either: the rail was `absolute`, so the overflow grew the DOCUMENT and
 * the stage page gained a scrollbar behind a fixed avatar.
 *
 * index.tsx pulls in three.js and cannot be mounted in jsdom, so the geometry lives in a pure
 * module and this is where it is held to account — plus a source check that index.tsx is actually
 * using it, because a cap that the page does not apply is a comment.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MENU_GAP_PX,
  MENU_ITEM_PX,
  MENU_ITEM_VR_PX,
  RAIL_ANCHOR_CLASS,
  RAIL_COLUMN_CLASS,
  railFitsIn,
  railHeightPx,
} from '@/features/stage/menuFit';

const index = readFileSync(join(process.cwd(), 'src/pages/index.tsx'), 'utf8');

/** The rail as it actually renders today: 11 buttons without `?dev=1`, 13 with it, plus the switch. */
const RAIL = { buttons: 11 };
const RAIL_DEV = { buttons: 13 };

/*
 * Usable viewport heights, not device heights — the browser chrome is real and eats 60-100px.
 * These are the three cases that matter: a phone on its side, the shortest phone upright, and a
 * laptop.
 */
const PHONE_LANDSCAPE = 330;
const PHONE_SE_PORTRAIT = 555;
const LAPTOP = 800;

describe('the measurement that motivated the cap', () => {
  it('the rail is taller than a phone held sideways', () => {
    expect(railHeightPx(RAIL)).toBe(480);
    expect(railFitsIn(PHONE_LANDSCAPE, RAIL)).toBe(false);
  });

  it('with ?dev=1 it does not even fit the shortest phone upright', () => {
    // Two extra creator buttons, and the column runs past the bottom of an iPhone SE.
    expect(railFitsIn(PHONE_SE_PORTRAIT, RAIL_DEV)).toBe(false);
    expect(railFitsIn(PHONE_SE_PORTRAIT, RAIL)).toBe(true);
  });

  it('on a laptop it fits, which is why this was invisible until somebody opened it on a phone', () => {
    expect(railFitsIn(LAPTOP, RAIL)).toBe(true);
    expect(railFitsIn(LAPTOP, RAIL_DEV)).toBe(true);
  });

  it('VR sizing doubles every icon, so the headset rail overflows a laptop-sized view', () => {
    expect(MENU_ITEM_VR_PX).toBe(MENU_ITEM_PX * 2);
    expect(railHeightPx({ ...RAIL, large: true })).toBeGreaterThan(railHeightPx(RAIL));
    expect(railFitsIn(LAPTOP, { ...RAIL, large: true })).toBe(false);
  });

  it('one more button costs exactly one item plus one gap', () => {
    // The property that makes this arithmetic worth having: it stays true as the rail keeps growing.
    expect(railHeightPx({ buttons: 12 }) - railHeightPx({ buttons: 11 })).toBe(MENU_ITEM_PX + MENU_GAP_PX);
  });

  it('an empty rail is just its padding — no negative gap arithmetic', () => {
    expect(railHeightPx({ buttons: 0, hasSwitch: false })).toBe(8);
    expect(railHeightPx({ buttons: -5, hasSwitch: false })).toBe(8);
  });
});

describe('the classes that make it fit', () => {
  it('the column is capped against the viewport and scrolls', () => {
    // dvh, not vh: on iOS `100vh` is the height with the toolbar retracted, so the last control
    // hides under the toolbar exactly when the toolbar is showing.
    expect(RAIL_COLUMN_CLASS).toContain('max-h-[calc(100dvh-1.5rem)]');
    expect(RAIL_COLUMN_CLASS).toContain('overflow-y-auto');
    // A scroll inside a panel over the avatar must not chain into the page behind it.
    expect(RAIL_COLUMN_CLASS).toContain('overscroll-contain');
  });

  it('the column does NOT centre its children', () => {
    /*
     * The subtle half of the bug. A flex column that centres and then overflows puts its first child
     * at a negative offset, and no scroll container can be scrolled above its own origin — so with
     * `justify-center` the TOP of the rail becomes unreachable the moment the cap starts doing its
     * job. Fixing the height without fixing this would have moved the unreachable controls from the
     * bottom of the list to the top of it.
     */
    expect(RAIL_COLUMN_CLASS).not.toContain('justify-center');
    expect(RAIL_COLUMN_CLASS).toContain('justify-start');
  });

  it('the rail is fixed, so its overflow can never grow the document', () => {
    expect(RAIL_ANCHOR_CLASS).toContain('fixed');
    expect(RAIL_ANCHOR_CLASS).not.toContain('absolute');
    // A `fixed` box with no insets falls back to its static position in the flow, which would depend
    // on whatever JSX happens to sit above it.
    expect(RAIL_ANCHOR_CLASS).toContain('left-0');
    expect(RAIL_ANCHOR_CLASS).toContain('top-0');
  });
});

describe('index.tsx actually uses it', () => {
  it('the rail is built from the module, not from a hand-copied class string', () => {
    expect(index).toContain('RAIL_ANCHOR_CLASS');
    expect(index).toContain('RAIL_COLUMN_CLASS');
  });

  it('the old uncapped rail is gone', () => {
    // The exact markup that shipped the bug. Literal on purpose: this is the string being outlawed.
    expect(index).not.toContain(`className="absolute z-10 m-2"`);
    expect(index).not.toContain(`'flex flex-col justify-center items-center p-1 space-y-3'`);
  });

  it('the rail really is at least as long as the arithmetic above assumes', () => {
    /*
     * A tripwire, not a count: three of these are either/or pairs (chat log, mute, webcam) and two
     * are behind `?dev=1`, so the number of <MenuButton> occurrences in the source is an upper bound
     * on what renders. What matters is that it has not shrunk to a length where the cap would be
     * dead code and somebody could "clean it up".
     */
    const occurrences = index.split('<MenuButton').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(RAIL.buttons);
  });
});
