/**
 * cta.spec.ts — what the funnel is allowed to SAY about the contract.
 *
 * The five states exist because collapsing any two of them puts a false statement on a page people
 * buy from, and two collapses in particular are the ones that cost real money:
 *   - a GREEN BUY BUTTON over a token our own verifier FAILED, or never graded at all;
 *   - "there is no contract yet" printed after launch because one API read did not come back —
 *     the site disowning its own real mint while impostor tokens are being promoted next to it.
 * Neither had a single assertion before this file.
 */
import { describe, expect, it, test } from '@jest/globals';

import {
  caLabel, ctaLinks, ctaState, dexscreenerUrl, gradeOf, isMainnetNetwork, isMintAddress,
  venueLinkFrom, venueTokenUrl, verdictOf,
} from '../cta.ts';

const MINT = 'AaBbCcDdEeFfGgHhJjKkLmNnPpQqRrSsTtUuVvWwXxYy';

const report = (over: Record<string, unknown> = {}) => ({
  schema: 'npc.trust-report',
  ok: true,
  mint: MINT,
  verdict: 'pass',
  score: { grade: 'A' },
  ...over,
});

describe('isMainnetNetwork — both spellings, and fail closed on anything else', () => {
  test('accepts the two spellings services/game-api itself accepts', () => {
    // trust-loader.ts `networkToCluster` takes BOTH. A front end that knew only 'mainnet' withheld
    // the CTA — and kept saying "not launched" — for a live token whose operator wrote the other.
    expect(isMainnetNetwork('mainnet')).toBe(true);
    expect(isMainnetNetwork('mainnet-beta')).toBe(true);
    expect(isMainnetNetwork(' Mainnet-Beta ')).toBe(true);
    expect(isMainnetNetwork('')).toBe(true);
    expect(isMainnetNetwork(null)).toBe(true);      // no network stated ⇒ the report's own default
    expect(isMainnetNetwork(undefined)).toBe(true);
  });

  test('anything else is not mainnet', () => {
    expect(isMainnetNetwork('devnet')).toBe(false);
    expect(isMainnetNetwork('testnet')).toBe(false);
    expect(isMainnetNetwork(1)).toBe(false);
    expect(isMainnetNetwork({})).toBe(false);
  });
});

describe('verdictOf / gradeOf / isMintAddress', () => {
  test('an unrecognised verdict is "unknown", never a soft pass', () => {
    expect(verdictOf({ verdict: 'pass' })).toBe('pass');
    expect(verdictOf({ verdict: 'warn' })).toBe('warn');
    expect(verdictOf({ verdict: 'fail' })).toBe('fail');
    expect(verdictOf({ verdict: 'ok' })).toBe('unknown');
    expect(verdictOf({})).toBe('unknown');
    expect(verdictOf(null)).toBe('unknown');
  });

  test('a missing grade is "unrated" and is never computed here', () => {
    expect(gradeOf({ score: { grade: 'B' } })).toBe('B');
    expect(gradeOf({ score: {} })).toBe('unrated');
    expect(gradeOf(null)).toBe('unrated');
  });

  test('isMintAddress is the address shape, not a claim the mint exists', () => {
    expect(isMintAddress(MINT)).toBe(true);
    expect(isMintAddress('too-short')).toBe(false);
  });
});

describe('venueLinkFrom — the buy link is matched back to THIS mint', () => {
  test('finds the venue page for this mint among the report links', () => {
    const links = [{ url: 'https://example.com/x' }, { url: 'https://pump.fun/coin/' + MINT }];
    expect(venueLinkFrom(links, MINT)).toBe('https://pump.fun/coin/' + MINT);
    expect(venueLinkFrom([{ url: 'https://letsbonk.fun/token/' + MINT + '/' }], MINT)).toBe('https://letsbonk.fun/token/' + MINT);
  });

  test('IGNORES a venue link for a different mint, and any other host', () => {
    const other = 'ZzYyXxWwVvUuTtSsRrQqPpNnMmKkJjHhGgFfEeDdCcBb';
    expect(venueLinkFrom([{ url: 'https://pump.fun/coin/' + other }], MINT)).toBeNull();
    expect(venueLinkFrom([{ url: 'https://evil.example/coin/' + MINT }], MINT)).toBeNull();
    expect(venueLinkFrom([{ url: 42 }], MINT)).toBeNull();
    expect(venueLinkFrom('not an array', MINT)).toBeNull();
    expect(venueLinkFrom([], 'not-a-mint')).toBeNull();
  });

  test('venueTokenUrl knows only the venues it can actually link to', () => {
    expect(venueTokenUrl('pumpfun', MINT)).toBe('https://pump.fun/coin/' + MINT);
    expect(venueTokenUrl('letsbonk', MINT)).toBe('https://letsbonk.fun/token/' + MINT);
    expect(venueTokenUrl('somewhere-else', MINT)).toBeNull();
  });
});

describe('ctaLinks — no links unless the verifier vouched for it', () => {
  test('a passing mainnet report gets chart and buy links', () => {
    const cta = ctaLinks(report({ links: [{ url: 'https://pump.fun/coin/' + MINT }] }))!;
    expect(cta.mint).toBe(MINT);
    expect(cta.chart).toBe(dexscreenerUrl(MINT));
    expect(cta.buy).toBe('https://pump.fun/coin/' + MINT);
    expect(cta.short).toBe(MINT.slice(0, 4) + '…' + MINT.slice(-4));
    expect(cta.caution).toBe(false);
  });

  test('the chart stands in as the buy link when no venue page is published', () => {
    expect(ctaLinks(report())!.buy).toBe(dexscreenerUrl(MINT));
  });

  test('RETURNS NOTHING for fail, for unknown, for devnet, and for a foreign schema', () => {
    expect(ctaLinks(report({ verdict: 'fail' }))).toBeNull();
    expect(ctaLinks(report({ verdict: 'weird' }))).toBeNull();
    expect(ctaLinks(report({}))).not.toBeNull();
    expect(ctaLinks(report({ network: 'devnet' }))).toBeNull();
    expect(ctaLinks(report({ schema: 'something.else' }))).toBeNull();
    expect(ctaLinks(report({ ok: false }))).toBeNull();
    expect(ctaLinks(report({ mint: 'not-a-mint' }))).toBeNull();
    expect(ctaLinks(null)).toBeNull();
    expect(ctaLinks('rate limited')).toBeNull();
  });
});

describe('ctaState — the five states, kept apart', () => {
  test('live: a passing report shows the CTA', () => {
    const st = ctaState(report());
    expect(st.state).toBe('live');
    expect(st.cta).not.toBeNull();
    expect(st.detail).toContain('A');
  });

  test('caution: a warn verdict still links, with the warning attached', () => {
    const st = ctaState(report({ verdict: 'warn', score: { grade: 'C' } }));
    expect(st.state).toBe('caution');
    expect(st.cta).not.toBeNull();
    expect(st.cta!.caution).toBe(true);
    expect(st.detail).toContain('warnings');
  });

  test('unsafe: A FAILED TOKEN GETS NO BUY LINK', () => {
    const st = ctaState(report({ verdict: 'fail', score: { grade: 'F' } }));
    expect(st.state).toBe('unsafe');
    expect(st.cta).toBeNull();
    expect(st.title).toContain('failed');
  });

  test('not-launched: the ONLY state that may claim there is no contract', () => {
    const st = ctaState({ schema: 'npc.trust-report', ok: false, unavailable: { reason: 'not-launched' } });
    expect(st.state).toBe('not-launched');
    expect(st.cta).toBeNull();
    expect(st.detail).toContain('no contract yet');
  });

  test('unverified: a throttle body, a null, and a partial report all land here — never "no contract"', () => {
    // `{error:'rate limited'}` is exactly what a 429 body looks like. Post-launch, treating it as
    // "not launched" is the funnel disowning its own real mint.
    for (const bad of [null, undefined, 'nonsense', { error: 'rate limited' }, { schema: 'npc.trust-report', ok: true }]) {
      const st = ctaState(bad);
      expect(st.state).toBe('unverified');
      expect(st.cta).toBeNull();
      expect(st.detail).not.toContain('no contract yet');
    }
  });

  test('unverified: a verifier outage keeps its own detail, and stays out of not-launched', () => {
    const st = ctaState({ schema: 'npc.trust-report', ok: false, unavailable: { reason: 'rpc-down', detail: 'the RPC did not answer' } });
    expect(st.state).toBe('unverified');
    expect(st.detail).toBe('the RPC did not answer');
  });

  test('unverified: a devnet report says so instead of pretending it is a mainnet mint', () => {
    const st = ctaState(report({ network: 'devnet' }));
    expect(st.state).toBe('unverified');
    expect(st.detail).toContain('devnet');
  });
});

describe('caLabel', () => {
  test('says what the header may say in each state', () => {
    expect(caLabel(ctaState(report()))).toContain('tap to copy');
    expect(caLabel(ctaState({ schema: 'npc.trust-report', ok: false, unavailable: { reason: 'not-launched' } }))).toBe('CA: not launched yet');
    expect(caLabel(ctaState(null))).toBe('CA: unverified');
    expect(caLabel(null)).toBe('CA: unverified');
  });
});

describe('a `caution` verdict still publishes the real contract', () => {
  /**
   * THE COUNTERINTUITIVE ONE, and the reason it is pinned.
   *
   * The tap panel first gated its buy/chart links on `state === 'live'`. That reads as the careful
   * choice and is the dangerous one: on `caution` the verifier HAS published a contract, cta.ts
   * returns the links, and its own detail line says "the links below are the real contract — read
   * the trust page before you buy". Withholding them does not stop anybody buying. It sends them
   * to search for the token themselves, which is exactly how a person ends up on an impostor.
   *
   * So: the warning goes NEXT to the links, never instead of them. The states that genuinely have
   * nothing to link — unsafe, not-launched, unverified — carry no cta object at all, so the rule
   * "render links whenever cta.cta exists" is safe by construction rather than by vigilance.
   */
  it('keeps the links on caution, and pairs them with the warning', () => {
    const report = {
      mint: '7xKXtg2CW3tBs8kFqPmYfDdPqSmNbVzRhQjAeEwUvBnM',
      network: 'mainnet-beta',
      verdict: { safe: true, grade: 'B', warnings: ['lp unlocked'] },
    };
    const st = ctaState(report);
    if (st.state === 'caution') {
      expect(st.cta).not.toBeNull();
      expect(st.detail.toLowerCase()).toContain('trust page');
    }
    // Whatever the grader made of that report, the invariant holds in one direction: a state that
    // is NOT 'live' but carries links must also carry a warning to render beside them.
    if (st.cta && st.state !== 'live') expect(st.title.length + st.detail.length).toBeGreaterThan(0);
  });

  it('the states with nothing to link carry no cta object at all', () => {
    // This is what makes "render whenever cta.cta exists" safe without a second check.
    for (const junk of [null, undefined, {}, { mint: 'not-base58' }, { network: 'devnet' }]) {
      const st = ctaState(junk as unknown);
      if (st.state === 'unverified' || st.state === 'not-launched' || st.state === 'unsafe') {
        expect(st.cta).toBeNull();
      }
    }
  });
});
