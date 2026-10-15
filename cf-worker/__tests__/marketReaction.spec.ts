/**
 * marketReaction.spec.ts — the Jev-picked live-market reaction, and its honest fallback.
 *
 * The properties that matter: the model only ever PICKS from candidates we authored (so the output
 * is bounded and on-persona), and when the key is unset or Jev fails, a deterministic in-code rule
 * still yields a real, in-character line — never a stub, never a fabricated one, never a broken tick.
 */
import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { bandForPct, ruleReaction, chooseReaction, type MarketSignal } from '../marketReaction';

const NO_KEY = {} as const;

/** A line must never read as financial advice — the persona's hard rule, locked as a test. */
const FORBIDDEN = /\b(buy|sell|ape|hodl|hold|long|short)\b/i;

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as { fetch?: unknown }).fetch;
});

describe('bandForPct', () => {
  it('bands a pump, a dump, and a chop', () => {
    expect(bandForPct(9)).toBe('up');
    expect(bandForPct(-9)).toBe('down');
    expect(bandForPct(1)).toBe('flat');
  });
  it('treats a missing/!finite number as flat (no opinion)', () => {
    for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(bandForPct(bad as number | null | undefined)).toBe('flat');
    }
  });
});

describe('ruleReaction (fallback)', () => {
  it('is deterministic: the same tape yields the same line', () => {
    const s: MarketSignal = { priceUsd: 223.65, change24h: 8.4 };
    expect(ruleReaction(s)).toEqual(ruleReaction(s));
  });

  it('reacts in the right band with a tagged, advice-free line', () => {
    const up = ruleReaction({ priceUsd: 10, change24h: 12 });
    expect(up.band).toBe('up');
    expect(up.source).toBe('rule');
    expect(up.reply.startsWith('[')).toBe(true);
    expect(up.line).not.toMatch(FORBIDDEN);

    const down = ruleReaction({ priceUsd: 10, change24h: -12 });
    expect(down.band).toBe('down');
    expect(down.emotion).toBe('sad');
    expect(down.line).not.toMatch(FORBIDDEN);
  });

  it('never emits an advice line across a wide sweep of moves', () => {
    for (let chg = -40; chg <= 40; chg += 0.5) {
      const r = ruleReaction({ priceUsd: 0.0042 + Math.abs(chg), change24h: chg });
      expect(r.reply).not.toMatch(FORBIDDEN);
    }
  });
});

describe('chooseReaction', () => {
  it('uses the deterministic rule when no key is set (no network call)', async () => {
    const fetchSpy = jest.fn();
    (globalThis as { fetch?: unknown }).fetch = fetchSpy;
    const r = await chooseReaction({ priceUsd: 100, change24h: 9 }, NO_KEY);
    expect(r.source).toBe('rule');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lets Jev pick tone/line/hype when the key is set', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        answers: {
          tone: { type: 'choice', choice: 'smug' },
          line: { type: 'choice', choice: 'l1' },
          hype: { type: 'score', score: 4 },
        },
      }),
    }));
    const r = await chooseReaction({ priceUsd: 250, change24h: 11 }, { TYPESAFE_API_KEY: 'sk-test' });
    expect(r.source).toBe('jev');
    expect(r.tone).toBe('smug');
    expect(r.emotion).toBe('victory');
    expect(r.band).toBe('up');
    expect(r.emote).toBe('stonks'); // hype 4 → a gesture on an up move
    expect(r.line.length).toBeGreaterThan(0);
    expect(r.reply).toContain(r.line);
    expect(r.line).not.toMatch(FORBIDDEN);
  });

  it('falls back to the rule when Jev returns a non-200', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    const r = await chooseReaction({ priceUsd: 250, change24h: -11 }, { TYPESAFE_API_KEY: 'sk-test' });
    expect(r.source).toBe('rule');
    expect(r.band).toBe('down');
  });

  it('falls back when Jev returns a choice key we did not supply', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        answers: {
          tone: { type: 'choice', choice: 'nonsense-tone' },
          line: { type: 'choice', choice: 'l99' },
          hype: { type: 'score', score: 2 },
        },
      }),
    }));
    const r = await chooseReaction({ priceUsd: 250, change24h: 2 }, { TYPESAFE_API_KEY: 'sk-test' });
    expect(r.source).toBe('rule');
  });

  it('falls back when the network throws', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => {
      throw new Error('boom');
    });
    const r = await chooseReaction({ priceUsd: 250, change24h: 7 }, { TYPESAFE_API_KEY: 'sk-test' });
    expect(r.source).toBe('rule');
  });
});
