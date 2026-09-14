/**
 * stageOverlays.spec.ts — two dark panels may not sit on top of each other over her.
 *
 * This is the geometry the rule exists for, measured on a 390px phone:
 *
 *   about  fixed left-12,  w min(21rem, 100vw-4rem)  →  x  48-374 of 390
 *   tap    fixed right-4,  w-64                      →  x 118-374 of 390
 *   trays  fixed right-2,  w-[8.5rem]                →  x 254-388 of 390
 *
 * Every pair overlaps except the two trays, which are drawn into one stacked column on purpose. On
 * a 1440px desktop none of them overlap, which is why this was invisible until somebody opened the
 * app on a phone — and it is the same stacked-cards complaint that started this whole change.
 *
 * index.tsx cannot be mounted in a test (it pulls in three.js), so the rule lives in a pure module
 * and this is where it is held to account.
 */
import { describe, expect, it } from '@jest/globals';

import {
  NO_OVERLAYS,
  closeStageOverlay,
  toggleStageOverlay,
  type StageOverlay,
  type StageOverlays,
} from '@/features/stage/overlays';

const ALL: StageOverlay[] = ['about', 'tap', 'emotes', 'backdrops'];
const allOpen: StageOverlays = { about: true, tap: true, emotes: true, backdrops: true };
const openNames = (s: StageOverlays) => ALL.filter((k) => s[k]);

/**
 * The worst case for the panel being OPENED: every other overlay already up.
 *
 * `toggleStageOverlay(allOpen, x)` would CLOSE x — it is a toggle — so the opening cases have to
 * start from a state where x is the one thing that is down. Writing it as a helper because getting
 * that backwards is how the first draft of this file asserted the opposite of the rule.
 */
const everythingElseOpen = (which: StageOverlay): StageOverlays => ({ ...allOpen, [which]: false });

describe('opening an overlay clears the screen for it', () => {
  it('the about column takes the stage alone', () => {
    expect(openNames(toggleStageOverlay(everythingElseOpen('about'), 'about'))).toEqual(['about']);
  });

  it('the tap panel takes the stage alone', () => {
    expect(openNames(toggleStageOverlay(everythingElseOpen('tap'), 'tap'))).toEqual(['tap']);
  });

  it('a tray dismisses both big panels but leaves the other tray', () => {
    // The two trays are rendered into one right-hand column (`flex flex-col items-end gap-2`) and
    // are meant to stack — reaching for an emote while choosing a backdrop is a real thing to want.
    expect(openNames(toggleStageOverlay(everythingElseOpen('emotes'), 'emotes'))).toEqual(['emotes', 'backdrops']);
    expect(openNames(toggleStageOverlay(everythingElseOpen('backdrops'), 'backdrops'))).toEqual(['emotes', 'backdrops']);
  });

  it('it does not OPEN the other tray, it only lets it survive', () => {
    // "backdrops coexists with emotes" must not become "backdrops opens emotes".
    const fromNothing = toggleStageOverlay(NO_OVERLAYS, 'backdrops');
    expect(openNames(fromNothing)).toEqual(['backdrops']);
  });
});

describe('closing an overlay touches nothing else', () => {
  it('toggling an open panel shut leaves the rest exactly as they were', () => {
    const state: StageOverlays = { about: false, tap: true, emotes: true, backdrops: false };
    expect(toggleStageOverlay(state, 'tap')).toEqual({ ...state, tap: false });
  });

  it('the × on a panel dismisses that one only', () => {
    expect(closeStageOverlay(allOpen, 'emotes')).toEqual({ ...allOpen, emotes: false });
  });

  it('closing something already closed is a no-op, not a reset', () => {
    const state: StageOverlays = { about: false, tap: true, emotes: false, backdrops: true };
    expect(closeStageOverlay(state, 'about')).toEqual(state);
  });
});

describe('the rule is total, so a panel added later cannot be forgotten', () => {
  it('every overlay closes every other one it is not declared to coexist with', () => {
    /*
     * The survivors are declared per overlay; anything not named is dismissed. That is the direction
     * that fails SAFE: a fifth panel somebody adds next year is closed by all four of these without
     * anyone remembering to come back here, and the failure mode of the opposite spelling — a list
     * of what to close — is the stacked-cards bug this module exists to prevent.
     */
    const COEXIST = new Set(['emotes|backdrops', 'backdrops|emotes']);
    for (const opened of ALL) {
      const after = toggleStageOverlay(everythingElseOpen(opened), opened);
      for (const other of ALL) {
        if (other === opened) continue;
        const allowed = COEXIST.has(`${opened}|${other}`);
        expect(`${opened} opened, ${other} ${after[other] ? 'still open' : 'closed'}`).toBe(
          `${opened} opened, ${other} ${allowed ? 'still open' : 'closed'}`,
        );
      }
    }
  });

  it('is pure — it never mutates the state it is handed', () => {
    // index.tsx reads the current overlays off a ref and writes four useState setters from the
    // result. A function that mutated its argument would corrupt the ref before React saw the write.
    const before: StageOverlays = { ...allOpen };
    toggleStageOverlay(before, 'about');
    closeStageOverlay(before, 'tap');
    expect(before).toEqual(allOpen);
  });
});

describe('the host applies it to every control that opens or closes a panel', () => {
  it('index.tsx routes all four menu buttons and all four dismissals through the rule', () => {
    /*
     * A single call site left on a raw `setShowX` is the whole bug back again, on that one button.
     * Scanned rather than rendered for this file's stated reason: mounting index.tsx means mounting
     * three.js.
     */
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const src = readFileSync(join(__dirname, '..', 'src/pages/index.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    for (const which of ALL) {
      expect(src).toContain(`toggleOverlay('${which}')`);
      expect(src).toContain(`closeOverlay('${which}')`);
    }
    // The raw setters may survive only as the declarations and as the writer inside `writeOverlays`.
    const rawWrites = src.match(/set(?:ShowAbout|ShowTapToWake|ShowEmotes|ShowBackdrops)\(/g) ?? [];
    expect(rawWrites.length).toBe(4);
  });
});
