/**
 * stageBackground.spec.ts — the stage stopped being black, and stays changeable.
 *
 * The regression this locks down is a one-character one: `bg_color` shipping non-empty alongside a
 * non-empty `bg_url` meant the colour won on every fresh visit and the ten bundled backgrounds were
 * unreachable. It is invisible in review (both values look correct on their own line) and obvious
 * on screen, which is exactly the shape of thing a test should hold.
 */
import { describe, expect, test } from '@jest/globals';

import {
  BACKDROPS,
  COLOR_BACKDROPS,
  DEFAULT_BG_URL,
  IMAGE_BACKDROPS,
  INK,
  activeBackdropId,
  applyBackground,
  labelForImage,
  resolveBackground,
} from '@/features/stage/background';
import { defaults } from '@/utils/config';
import { bgImages } from '@/paths';

describe('the shipped default', () => {
  test('a fresh visit lands on a background IMAGE, not on a colour', () => {
    // This is the whole bug: two non-empty defaults, and the colour silently wins.
    expect(defaults.bg_color).toBe('');
    expect(defaults.bg_url).not.toBe('');
    expect(resolveBackground(defaults.bg_color, defaults.bg_url)).toEqual({
      kind: 'image',
      url: DEFAULT_BG_URL,
    });
  });

  test('the default image is one that actually ships', () => {
    expect(bgImages).toContain(DEFAULT_BG_URL);
    expect(defaults.bg_url).toBe(DEFAULT_BG_URL);
  });

  test('ink is still one press away', () => {
    expect(COLOR_BACKDROPS[0].value).toBe(INK);
    expect(resolveBackground(INK, DEFAULT_BG_URL)).toEqual({ kind: 'color', color: INK });
  });
});

describe('resolveBackground — one rule, stated once', () => {
  test('a colour wins over an image, which is what both settings pages write for', () => {
    expect(resolveBackground('#123456', '/bg/bg-room1.jpg')).toEqual({ kind: 'color', color: '#123456' });
  });

  test('with no colour, the image is drawn', () => {
    expect(resolveBackground('', '/bg/bg-town1.jpg')).toEqual({ kind: 'image', url: '/bg/bg-town1.jpg' });
  });

  test('with neither, it falls back to the default image rather than to a blank body', () => {
    expect(resolveBackground('', '')).toEqual({ kind: 'image', url: DEFAULT_BG_URL });
    expect(resolveBackground(undefined, null)).toEqual({ kind: 'image', url: DEFAULT_BG_URL });
  });

  test('whitespace is not a colour', () => {
    expect(resolveBackground('   ', '/bg/bg-room1.jpg')).toEqual({ kind: 'image', url: '/bg/bg-room1.jpg' });
  });

  test('transparent is a colour like any other — it is a deliberate choice, not "unset"', () => {
    expect(resolveBackground('transparent', DEFAULT_BG_URL)).toEqual({ kind: 'color', color: 'transparent' });
  });
});

describe('applyBackground — the other half of the old bug', () => {
  test('a colour clears the image, so nothing is left painted underneath it', () => {
    const body = document.createElement('div');
    body.style.backgroundImage = 'url(/bg/bg-room1.jpg)';
    applyBackground({ kind: 'color', color: '#101423' }, body);
    expect(body.style.backgroundImage).toBe('none');
    expect(body.style.backgroundColor).toBe('rgb(16, 20, 35)');
  });

  test('an image clears the colour, so a leftover colour cannot tint a scene', () => {
    const body = document.createElement('div');
    body.style.backgroundColor = '#ff0000';
    applyBackground({ kind: 'image', url: '/bg/bg-town1.jpg' }, body);
    expect(body.style.backgroundImage).toContain('/bg/bg-town1.jpg');
    expect(body.style.backgroundColor).toBe('transparent');
  });

  test('a missing body is a no-op, not a crash', () => {
    expect(() => applyBackground({ kind: 'color', color: INK }, null)).not.toThrow();
  });
});

describe('the picker', () => {
  test('offers every bundled image plus the solid backdrops, with no duplicate ids', () => {
    expect(IMAGE_BACKDROPS).toHaveLength(bgImages.length);
    expect(BACKDROPS).toHaveLength(bgImages.length + COLOR_BACKDROPS.length);
    expect(new Set(BACKDROPS.map((b) => b.id)).size).toBe(BACKDROPS.length);
  });

  test('opens on the scene she is already standing in', () => {
    expect(IMAGE_BACKDROPS[0].value).toBe(DEFAULT_BG_URL);
  });

  test('every entry is labelled and points at something real', () => {
    for (const b of BACKDROPS) {
      expect(b.label.length).toBeGreaterThan(0);
      expect(b.id).toBe(b.value);
      if (b.kind === 'image') expect(bgImages).toContain(b.value);
    }
  });

  test('the selected tile follows the config, whichever kind is live', () => {
    expect(activeBackdropId('', '/bg/bg-sunset1.jpg')).toBe('/bg/bg-sunset1.jpg');
    expect(activeBackdropId(INK, '/bg/bg-sunset1.jpg')).toBe(INK);
  });

  test('an unlabelled image still gets a readable name rather than a path', () => {
    expect(labelForImage('/bg/bg-room2.jpg')).toBe('lofi room');
    expect(labelForImage('/bg/bg-my_new-scene.png')).toBe('my new scene');
  });
});
