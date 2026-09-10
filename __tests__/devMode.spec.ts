/**
 * devMode.spec.ts — who sees the developer tools (NEXT-PHASES.md P1#4).
 *
 * The precedence is the whole contract: an explicit `?dev=0` must beat a remembered opt-in, or a
 * developer who wants to check the consumer stage has no way back without clearing site data.
 */
import { describe, expect, it } from '@jest/globals';
import { resolveDevMode } from '@/utils/devMode';

describe('resolveDevMode', () => {
  it('defaults to the consumer stage', () => {
    expect(resolveDevMode('', false)).toBe(false);
    expect(resolveDevMode('?foo=1', false)).toBe(false);
  });

  it('turns on for the forms a developer actually types', () => {
    // Somebody who typed `?dev` and got the consumer stage would reasonably call that broken.
    for (const q of ['?dev=1', '?dev', '?dev=true', '?dev=TRUE', '?dev=yes', '?a=b&dev=1']) {
      expect(resolveDevMode(q, false)).toBe(true);
    }
  });

  it('an explicit off BEATS a remembered opt-in', () => {
    // The way back. Without it the only exit from dev mode is clearing site data.
    for (const q of ['?dev=0', '?dev=false', '?dev=off', '?dev=OFF']) {
      expect(resolveDevMode(q, true)).toBe(false);
    }
  });

  it('keeps what the tab remembered when the parameter is absent', () => {
    // A developer navigating between routes must not fall back to the consumer stage on every hop.
    expect(resolveDevMode('', true)).toBe(true);
    expect(resolveDevMode('?other=2', true)).toBe(true);
  });

  it('survives a search string that is not parseable', () => {
    // It decides what a menu shows; it must never be able to throw on a page load.
    expect(resolveDevMode('%%%', false)).toBe(false);
    expect(resolveDevMode(undefined as unknown as string, true)).toBe(true);
  });
});
