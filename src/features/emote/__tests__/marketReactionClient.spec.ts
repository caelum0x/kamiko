/**
 * marketReactionClient.spec.ts — the stage's same-origin reaction fetch degrades to silence, never
 * an error and never a fabricated line.
 */
import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { fetchMarketReaction } from '../marketReactionClient';

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as { fetch?: unknown }).fetch;
});

describe('fetchMarketReaction', () => {
  it('returns the spoken reply on a 200', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ reply: '[happy] the tape is green and i am insufferable' }),
    }));
    expect(await fetchMarketReaction()).toBe('[happy] the tape is green and i am insufferable');
  });

  it('stays silent (null) on a 503 unconfigured/no-quote deploy', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) }));
    expect(await fetchMarketReaction()).toBeNull();
  });

  it('stays silent on a network error', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => {
      throw new Error('offline');
    });
    expect(await fetchMarketReaction()).toBeNull();
  });

  it('stays silent when the body carries no usable reply', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({ ok: true, json: async () => ({ reply: '   ' }) }));
    expect(await fetchMarketReaction()).toBeNull();
  });
});
