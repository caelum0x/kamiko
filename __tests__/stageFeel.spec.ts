/**
 * stageFeel.spec.ts — the avatar-feel wiring: viseme mouth mapping, expression blending, and
 * emotion-driven idle temperament.
 *
 * Each test would fail without the behaviour it names. These three modules are what changed the
 * stage from "volume flap + jump-cut face + one fixed sway" to "phoneme mouth + eased face +
 * mood-coloured idle", and all of them feed a live rig every frame — so range, settling and
 * bounds are the contract, not niceties.
 */
import { describe, expect, test } from '@jest/globals';

import { VOWEL_TO_VRM, VRM_MOUTH_EXPRESSIONS, mouthDamp, vowelsToVrmWeights } from '@/features/lipSync/visemes';
import { approach, stepBlends, SETTLE_EPSILON, type BlendState } from '@/features/emoteController/expressionBlend';
import { moodFor, MAX_SWAY, MAX_TEMPO, MIN_SWAY, MIN_TEMPO, NEUTRAL_MOOD } from '@/features/proceduralAnimation/emotionMood';
import { createWLipSyncVowelDriver } from '@/airi/lipsync/shared/wlipsync';

describe('viseme → VRM mouth mapping', () => {
  test('the five airi vowels land on the five VRM mouth presets', () => {
    expect(Object.values(VOWEL_TO_VRM).sort()).toEqual([...VRM_MOUTH_EXPRESSIONS].sort());
    const w = vowelsToVrmWeights({ A: 0.6, E: 0.1, I: 0, O: 0.2, U: 0 });
    expect(w).toEqual({ aa: 0.6, ee: 0.1, ih: 0, oh: 0.2, ou: 0 });
  });

  test('an emotion on the face damps the mouth, neutral does not', () => {
    expect(mouthDamp('neutral')).toBe(1);
    expect(mouthDamp('angry')).toBe(0.5);
    const damped = vowelsToVrmWeights({ A: 0.6, E: 0, I: 0, O: 0, U: 0 }, mouthDamp('angry'));
    expect(damped.aa).toBeCloseTo(0.3);
  });

  test('weights are clamped to [0,1] whatever the driver emits — a broken frame cannot break the mesh', () => {
    const w = vowelsToVrmWeights({ A: 7, E: -3, I: NaN, O: Infinity, U: 0.5 });
    expect(w.aa).toBe(1); // over-range caps at fully open
    expect(w.ee).toBe(0); // negative closes
    expect(w.ih).toBe(0); // NaN closes — fail-closed, never NaN into the mesh
    expect(w.oh).toBe(0); // Infinity is not a weight; closed, not "fully open forever"
    expect(w.ou).toBe(0.5);
  });

  test("the merged vowel driver actually produces mouth-shaped output from a viseme frame (the wiring's upstream half)", () => {
    let t = 0;
    const driver = createWLipSyncVowelDriver(() => t);
    const first = driver.update({ volume: 1, weights: { A: 0.9 } }, 0.016);
    t += 16;
    const second = driver.update({ volume: 1, weights: { A: 0.9 } }, 0.016);
    expect(second.A).toBeGreaterThan(0); // the loud A vowel opens the A mouth…
    expect(second.A).toBeGreaterThanOrEqual(first.A); // …and smoothing rises toward it
    expect(second.O).toBe(0); // silent vowels stay closed
  });
});

describe('expression blending (the face no longer jump-cuts)', () => {
  test('one step moves partway to the target — never the whole way in a frame', () => {
    const step = approach(0, 1, 1 / 60);
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThan(0.5);
  });

  test('attack is faster than release (asymmetric taus)', () => {
    const up = approach(0, 1, 1 / 60);
    const down = 1 - approach(1, 0, 1 / 60);
    expect(up).toBeGreaterThan(down);
  });

  test('settles exactly on the target instead of oscillating forever', () => {
    let v = 0;
    for (let i = 0; i < 600; i++) v = approach(v, 1, 1 / 60);
    expect(v).toBe(1);
  });

  test('never overshoots and never goes negative', () => {
    expect(approach(0.99, 1, 10)).toBeLessThanOrEqual(1);
    expect(approach(0.01, 0, 10)).toBeGreaterThanOrEqual(0);
  });

  test('a non-finite dt (first frame, tab resume) changes nothing', () => {
    expect(approach(0.4, 1, NaN)).toBe(0.4);
    expect(approach(0.4, 1, -1)).toBe(0.4);
  });

  test('stepBlends eases every entry, drops fully-released ones, and never mutates its input', () => {
    const blends = new Map<string, BlendState>([
      ['happy', { target: 1, current: 0 }],
      ['angry', { target: 0, current: SETTLE_EPSILON / 2 }],
    ]);
    const { next, weights } = stepBlends(blends, 1 / 60);
    expect(blends.get('happy')!.current).toBe(0); // input untouched
    expect(next.get('happy')!.current).toBeGreaterThan(0);
    expect(next.has('angry')).toBe(false); // released and settled ⇒ dropped
    // …but its final 0 was still written this frame, so the face actually closes:
    expect(weights.find(([n]) => n === 'angry')![1]).toBe(0);
  });
});

describe('emotion-driven idle temperament', () => {
  test('agitated emotions pace faster and wider, drowsy ones slower and smaller', () => {
    expect(moodFor('angry').tempo).toBeGreaterThan(1);
    expect(moodFor('angry').sway).toBeGreaterThan(1);
    expect(moodFor('sleep').tempo).toBeLessThan(1);
    expect(moodFor('sad').sway).toBeLessThan(1);
  });

  test('case-insensitive: the bridge sends lowercase tags, amica capitalises some', () => {
    expect(moodFor('Surprised')).toEqual(moodFor('surprised'));
    expect(moodFor('Sleep').tempo).toBeLessThan(1);
  });

  test('an unknown or empty tag idles neutral — a new emotion can never destabilise the rig', () => {
    expect(moodFor('zoomies')).toEqual(NEUTRAL_MOOD);
    expect(moodFor('')).toEqual(NEUTRAL_MOOD);
    expect(moodFor(undefined as unknown as string)).toEqual(NEUTRAL_MOOD);
  });

  test('every mapped mood sits inside the hard bounds', () => {
    for (const e of ['neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised', 'shy', 'jealous', 'bored', 'serious', 'suspicious', 'victory', 'sleep', 'love']) {
      const m = moodFor(e);
      expect(m.tempo).toBeGreaterThanOrEqual(MIN_TEMPO);
      expect(m.tempo).toBeLessThanOrEqual(MAX_TEMPO);
      expect(m.sway).toBeGreaterThanOrEqual(MIN_SWAY);
      expect(m.sway).toBeLessThanOrEqual(MAX_SWAY);
    }
  });
});
