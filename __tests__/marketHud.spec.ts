/**
 * marketHud.spec.ts — the numbers the HUD puts next to a token's name (NEXT-PHASES.md P1#6).
 *
 * These four functions decide what a holder reads on the stage. Every input below is one the
 * network actually produces — an absent field, a null, a string where a number was promised, a
 * value out of range — and the rule is the same one the rest of this repo enforces on money
 * surfaces: say nothing rather than say something untrue. `NaN%` beside a ticker is the kind of
 * thing somebody screenshots.
 *
 * The live verification the plan asks for cannot happen until $KAMIKO launches. This is the half
 * that can be verified now, so it is.
 */
import { describe, expect, it } from '@jest/globals';
import { fmtPct, fmtUsd, graduationPercent, pctClass } from '@/components/tapToWake';

describe('fmtUsd', () => {
  it('renders a price', () => {
    expect(fmtUsd(223.65)).toContain('223');
    expect(fmtUsd(1)).toContain('1');
  });

  it('says nothing for every shape that is not a number', () => {
    // A dash or a zero would both be claims. Absent is the truth.
    for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(fmtUsd(bad as number | null | undefined)).not.toMatch(/\d/);
    }
  });

  it('does not round a sub-cent token down to zero', () => {
    // A freshly launched bonding-curve token trades far below a cent. "$0.00" reads as worthless
    // rather than as small, which changes what the number MEANS to whoever is looking at it.
    const out = fmtUsd(0.000042);
    expect(out).not.toBe('$0.00');
    expect(out).toMatch(/[1-9]/);
  });
});

describe('fmtPct', () => {
  it('always signs the move', () => {
    // Unsigned, "2.40%" sitting beside a price reads as another price. The sign is what makes it
    // a change.
    expect(fmtPct(2.4)).toBe('+2.40%');
    expect(fmtPct(-11)).toBe('-11.00%');
    expect(fmtPct(0)).toBe('+0.00%');
  });

  it('is empty when there is no number to sign', () => {
    for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(fmtPct(bad as number | null | undefined)).toBe('');
    }
  });
});

describe('pctClass — colour follows the number, never the other way round', () => {
  it('is green up and red down, with zero counted as up', () => {
    expect(pctClass(1)).toContain('emerald');
    expect(pctClass(0)).toContain('emerald');
    expect(pctClass(-0.01)).toContain('rose');
  });

  it('is dimmed, not coloured, when the move is unknown', () => {
    // An unknown move painted green is a claim that the token is up.
    for (const bad of [null, undefined, Number.NaN]) {
      const cls = pctClass(bad as number | null | undefined);
      expect(cls).not.toContain('emerald');
      expect(cls).not.toContain('rose');
    }
  });
});

describe('graduationPercent — the bonding curve, or silence', () => {
  it('reports a clamped whole percent for a live token', () => {
    expect(graduationPercent({ live: true, finishingRate: 0 })).toBe(0);
    expect(graduationPercent({ live: true, finishingRate: 0.374 })).toBe(37);
    expect(graduationPercent({ live: true, finishingRate: 1 })).toBe(100);
  });

  it('clamps a reading that escaped its range instead of drawing past the bar', () => {
    expect(graduationPercent({ live: true, finishingRate: 1.4 })).toBe(100);
    expect(graduationPercent({ live: true, finishingRate: -0.2 })).toBe(0);
  });

  it('says nothing before the token is live', () => {
    // Before launch there is no curve. A graduation reading for a token that does not exist yet is
    // exactly the number a stranger screenshots as evidence of something.
    expect(graduationPercent({ live: false, finishingRate: 0.5 })).toBeNull();
    expect(graduationPercent({ finishingRate: 0.5 })).toBeNull();
    expect(graduationPercent(null)).toBeNull();
    expect(graduationPercent(undefined)).toBeNull();
  });

  it('says nothing when the reading is not a usable number', () => {
    // Every one of these is a real answer from a partial upstream read.
    for (const bad of [null, undefined, '0.5', Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      expect(graduationPercent({ live: true, finishingRate: bad })).toBeNull();
    }
  });
});
