/**
 * config.spec.ts — the env resolution, the 429 rule, and the tip-destination cross-check.
 *
 * WHY THIS FILE EXISTS: services/game-api's half of the money contract is tested
 * (services/game-api/tip-outcome.test.ts), and this half — the half that decides whether a real
 * mainnet transfer is built at all — was not tested by anything. The two envs this module resolves
 * are the ones DEPLOY.md warns about in prose four separate times and enforced nowhere.
 *
 * Every module-level constant here is resolved at import time from `process.env`, so the tests that
 * care about a particular deployment shape set the env and re-import through `jest.resetModules()`.
 * That is not a trick: it is exactly what a Next build does, one build at a time.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

type ConfigModule = typeof import('../config.ts');

/** A live 44-char base58 Solana address shape (the api's side of the cross-check). */
const API_WALLET = 'AaBbCcDdEeFfGgHhJjKkLmNnPpQqRrSsTtUuVvWwXxYy';
/** A DIFFERENT valid address — the shape of a front end built against a rotated tip wallet. */
const BUILD_WALLET = 'ZzYyXxWwVvUuTtSsRrQqPpNnMmKkJjHhGgFfEeDdCcBb';

/** Load `config.ts` as if this deployment's env had been set at build time. */
async function loadConfig(env: Record<string, string | undefined> = {}): Promise<ConfigModule> {
  jest.resetModules();
  for (const key of [
    'NEXT_PUBLIC_NPC_API', 'NEXT_PUBLIC_NPC_TIP_WALLET', 'NEXT_PUBLIC_NPC_RPC', 'NEXT_PUBLIC_NPC_VAPID',
    'NEXT_PUBLIC_NPC_MIN_TIP_SOL', 'NEXT_PUBLIC_NPC_MAX_TIP_SOL', 'NEXT_PUBLIC_NPC_TIP_CONFIRM_SOL',
  ]) delete process.env[key];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  return import('../config.ts');
}

/** A response with just the surface `throttleRetryMs`/`readJson` actually read. */
function res(status: number, opts: { headers?: Record<string, string>; body?: unknown; unreadable?: boolean } = {}): Response {
  const headers = opts.headers || {};
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => {
      if (opts.unreadable) throw new SyntaxError('Unexpected end of JSON input');
      return opts.body;
    },
  } as unknown as Response;
}

beforeEach(() => { jest.restoreAllMocks(); });

describe('isBase58Address', () => {
  test('accepts the 32..44 char base58 shape a Solana address has', async () => {
    const { isBase58Address } = await loadConfig();
    expect(isBase58Address(API_WALLET)).toBe(true);
    expect(isBase58Address('1'.repeat(32))).toBe(true);
    expect(isBase58Address('1'.repeat(44))).toBe(true);
  });

  test('rejects the near-misses that would otherwise reach PublicKey()', async () => {
    const { isBase58Address } = await loadConfig();
    expect(isBase58Address('1'.repeat(31))).toBe(false);
    expect(isBase58Address('1'.repeat(45))).toBe(false);
    // 0, O, I and l are the four characters base58 leaves out precisely because they are confusable.
    expect(isBase58Address('0'.repeat(40))).toBe(false);
    expect(isBase58Address('O'.repeat(40))).toBe(false);
    expect(isBase58Address('I'.repeat(40))).toBe(false);
    expect(isBase58Address('l'.repeat(40))).toBe(false);
    expect(isBase58Address('')).toBe(false);
    expect(isBase58Address(null)).toBe(false);
    expect(isBase58Address(undefined)).toBe(false);
    expect(isBase58Address(12345)).toBe(false);
  });
});

describe('env resolution', () => {
  test('API drops trailing slashes, and is empty (not guessed) when unset', async () => {
    expect((await loadConfig({ NEXT_PUBLIC_NPC_API: 'https://api.example.com///' })).API).toBe('https://api.example.com');
    expect((await loadConfig()).API).toBe('');
  });

  test('an unparseable tip wallet is "not configured", never "close enough"', async () => {
    expect((await loadConfig({ NEXT_PUBLIC_NPC_TIP_WALLET: BUILD_WALLET })).TIP_WALLET).toBe(BUILD_WALLET);
    // A truncated paste is the realistic way this goes wrong, and it must disable tipping outright.
    expect((await loadConfig({ NEXT_PUBLIC_NPC_TIP_WALLET: BUILD_WALLET.slice(0, 20) })).TIP_WALLET).toBe('');
    expect((await loadConfig({ NEXT_PUBLIC_NPC_TIP_WALLET: 'not a wallet' })).TIP_WALLET).toBe('');
  });

  test('RPC falls back to public mainnet only when nothing is configured', async () => {
    expect((await loadConfig()).RPC).toBe('https://api.mainnet-beta.solana.com');
    expect((await loadConfig({ NEXT_PUBLIC_NPC_RPC: 'https://rpc.example/x/' })).RPC).toBe('https://rpc.example/x');
  });
});

describe('positiveEnvNumber', () => {
  test('takes a positive number and rejects everything that is not one', async () => {
    const { positiveEnvNumber } = await loadConfig();
    expect(positiveEnvNumber('0.5', 9)).toBe(0.5);
    expect(positiveEnvNumber(2.5, 9)).toBe(2.5);
    expect(positiveEnvNumber('', 9)).toBe(9);
    expect(positiveEnvNumber(undefined, 9)).toBe(9);
    expect(positiveEnvNumber('abc', 9)).toBe(9);
    expect(positiveEnvNumber('0', 9)).toBe(9);
    expect(positiveEnvNumber('-3', 9)).toBe(9);
    expect(positiveEnvNumber('Infinity', 9)).toBe(9);
    expect(positiveEnvNumber({}, 9)).toBe(9);
  });

  test('a garbage ceiling falls back rather than becoming NaN', async () => {
    // The failure this guards: `sol > NaN` is false for every amount, so a NaN ceiling silently
    // REMOVES the tip cap instead of tightening it.
    const cfg = await loadConfig({ NEXT_PUBLIC_NPC_MAX_TIP_SOL: 'ten' });
    expect(cfg.MAX_TIP_SOL).toBe(10);
    expect(Number.isNaN(cfg.MAX_TIP_SOL)).toBe(false);
  });

  test('an operator can raise or lower the bounds for their own deployment', async () => {
    const cfg = await loadConfig({
      NEXT_PUBLIC_NPC_MIN_TIP_SOL: '0.05',
      NEXT_PUBLIC_NPC_MAX_TIP_SOL: '250',
      NEXT_PUBLIC_NPC_TIP_CONFIRM_SOL: '25',
    });
    expect(cfg.MIN_TIP_SOL).toBe(0.05);
    expect(cfg.MAX_TIP_SOL).toBe(250);
    expect(cfg.TIP_CONFIRM_SOL).toBe(25);
  });

  test('the shipped defaults are a real, usable window', async () => {
    const cfg = await loadConfig();
    expect(cfg.MIN_TIP_SOL).toBe(0.01);
    expect(cfg.MAX_TIP_SOL).toBe(10);
    expect(cfg.TIP_CONFIRM_SOL).toBe(1);
    expect(cfg.MIN_TIP_SOL).toBeLessThan(cfg.TIP_CONFIRM_SOL);
    expect(cfg.TIP_CONFIRM_SOL).toBeLessThanOrEqual(cfg.MAX_TIP_SOL);
  });
});

describe('throttleRetryMs — a 429 is our own rate limiter, not a verdict', () => {
  test('a non-429 is not a throttle', async () => {
    const { throttleRetryMs } = await loadConfig();
    expect(await throttleRetryMs(res(200, { body: { ok: true } }))).toBeNull();
    expect(await throttleRetryMs(res(503, { body: { ok: false } }))).toBeNull();
    expect(await throttleRetryMs(res(402, { body: { error: 'no matching transfer' } }))).toBeNull();
  });

  test('the Retry-After header is authoritative', async () => {
    const { throttleRetryMs } = await loadConfig();
    expect(await throttleRetryMs(res(429, { headers: { 'retry-after': '7' }, body: { retryAfterSec: 99 } }))).toBe(7000);
  });

  test("falls back to the body's retryAfterSec, because the bridge does not always relay headers", async () => {
    const { throttleRetryMs } = await loadConfig();
    expect(await throttleRetryMs(res(429, { body: { error: 'rate limited', retryAfterSec: 12 } }))).toBe(12000);
  });

  test('an unreadable throttle still parks the caller for the 1s floor', async () => {
    const { throttleRetryMs } = await loadConfig();
    expect(await throttleRetryMs(res(429, { unreadable: true }))).toBe(1000);
    expect(await throttleRetryMs(res(429, { body: { error: 'rate limited' } }))).toBe(1000);
    // A negative or zero Retry-After must not produce a zero-length backoff — that is a hot loop.
    expect(await throttleRetryMs(res(429, { headers: { 'retry-after': '-5' } }))).toBe(1000);
  });

  test('a huge Retry-After is clamped to MAX_BACKOFF_MS', async () => {
    const { throttleRetryMs, MAX_BACKOFF_MS } = await loadConfig();
    expect(await throttleRetryMs(res(429, { headers: { 'retry-after': '86400' } }))).toBe(MAX_BACKOFF_MS);
  });
});

describe('readJson', () => {
  test('an unconfigured API never touches the network', async () => {
    const cfg = await loadConfig();
    const fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
    expect(await cfg.readJson('/anything')).toEqual({ ok: false, throttled: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('reports a throttle as a throttle, so callers keep the numbers already on screen', async () => {
    const cfg = await loadConfig({ NEXT_PUBLIC_NPC_API: 'https://api.example' });
    (globalThis as any).fetch = jest.fn(async () => res(429, { headers: { 'retry-after': '3' } }));
    expect(await cfg.readJson('https://api.example/stats')).toEqual({ ok: false, throttled: true, retryAfterMs: 3000 });
  });

  test('a network error, a non-2xx and unparseable JSON are all plain failures', async () => {
    const cfg = await loadConfig({ NEXT_PUBLIC_NPC_API: 'https://api.example' });
    (globalThis as any).fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await cfg.readJson('https://api.example/stats')).toEqual({ ok: false, throttled: false });
    (globalThis as any).fetch = jest.fn(async () => res(500, { body: { error: 'boom' } }));
    expect(await cfg.readJson('https://api.example/stats')).toEqual({ ok: false, throttled: false });
    (globalThis as any).fetch = jest.fn(async () => res(200, { unreadable: true }));
    expect(await cfg.readJson('https://api.example/stats')).toEqual({ ok: false, throttled: false });
  });

  test('a 200 returns the parsed body', async () => {
    const cfg = await loadConfig({ NEXT_PUBLIC_NPC_API: 'https://api.example' });
    (globalThis as any).fetch = jest.fn(async () => res(200, { body: { globalWakes: 42 } }));
    expect(await cfg.readJson<{ globalWakes: number }>('https://api.example/stats')).toEqual({ ok: true, data: { globalWakes: 42 } });
  });
});

describe('classifyTipDestination — the check that stops a tip being burned', () => {
  test('agreement is the only way to build a transaction', async () => {
    const { classifyTipDestination } = await loadConfig();
    const out = classifyTipDestination(API_WALLET, { ok: true, data: { tipWallet: API_WALLET, mint: null, cluster: 'mainnet-beta' } });
    expect(out).toEqual({ ok: true, wallet: API_WALLET });
  });

  test('A MISMATCH IS REFUSED, and the refusal names BOTH addresses', async () => {
    const { classifyTipDestination } = await loadConfig();
    const out = classifyTipDestination(BUILD_WALLET, { ok: true, data: { tipWallet: API_WALLET, mint: null, cluster: 'mainnet-beta' } });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.kind).toBe('mismatch');
    // Both addresses, or the operator cannot tell which of their two envs is the stale one.
    expect(out.why).toContain(BUILD_WALLET);
    expect(out.why).toContain(API_WALLET);
    expect(out.why).toContain('nothing has left your wallet');
  });

  test('a case-different address is a mismatch — base58 is case-sensitive', async () => {
    const { classifyTipDestination } = await loadConfig();
    const out = classifyTipDestination(API_WALLET, {
      ok: true,
      // Only the FIRST character's case differs, and both cases are legal base58 — so this is a
      // well-formed address that is simply not ours.
      data: { tipWallet: 'a' + API_WALLET.slice(1), mint: null, cluster: 'mainnet-beta' },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe('mismatch');
  });

  test('an unreachable /config FAILS CLOSED, distinguishably from a mismatch', async () => {
    const { classifyTipDestination } = await loadConfig();
    const down = classifyTipDestination(API_WALLET, { ok: false, throttled: false });
    expect(down.ok).toBe(false);
    if (down.ok) throw new Error('unreachable');
    expect(down.kind).toBe('unreachable');
    expect(down.why).toContain('nothing has left your wallet');

    const throttled = classifyTipDestination(API_WALLET, { ok: false, throttled: true, retryAfterMs: 5000 });
    expect(throttled.ok).toBe(false);
    if (throttled.ok) throw new Error('unreachable');
    expect(throttled.kind).toBe('unreachable');
    // A throttle and an outage both refuse, but they do not read the same on screen.
    expect(throttled.why).not.toBe(down.why);
  });

  test('an api with no tip wallet, and a build with no tip wallet, are different refusals', async () => {
    const { classifyTipDestination } = await loadConfig();
    const apiOff = classifyTipDestination(API_WALLET, { ok: true, data: { tipWallet: null, mint: null, cluster: 'mainnet-beta' } });
    expect(apiOff.ok).toBe(false);
    if (!apiOff.ok) expect(apiOff.kind).toBe('api-unconfigured');

    const localOff = classifyTipDestination('', { ok: true, data: { tipWallet: API_WALLET, mint: null, cluster: 'mainnet-beta' } });
    expect(localOff.ok).toBe(false);
    if (!localOff.ok) expect(localOff.kind).toBe('local-unconfigured');
  });

  test('a malformed tipWallet from the api is treated as no tip wallet, never trusted', async () => {
    const { classifyTipDestination } = await loadConfig();
    for (const bad of ['', 'not-an-address', API_WALLET.slice(0, 10), 42, {}, undefined]) {
      const out = classifyTipDestination(API_WALLET, { ok: true, data: { tipWallet: bad as any, mint: null, cluster: 'x' } });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.kind).toBe('api-unconfigured');
    }
  });

  test('a build with no tip wallet is refused before the api is even consulted', async () => {
    const { classifyTipDestination } = await loadConfig();
    const out = classifyTipDestination('', { ok: false, throttled: false });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe('local-unconfigured');
  });
});

describe('checkTipDestination', () => {
  test('asks GET /config on the configured api and passes the answer through the classifier', async () => {
    const cfg = await loadConfig({ NEXT_PUBLIC_NPC_API: 'https://api.example/', NEXT_PUBLIC_NPC_TIP_WALLET: API_WALLET });
    const fetchMock = jest.fn(async () => res(200, { body: { tipWallet: API_WALLET, mint: null, cluster: 'mainnet-beta' } }));
    (globalThis as any).fetch = fetchMock as any;
    expect(await cfg.checkTipDestination()).toEqual({ ok: true, wallet: API_WALLET });
    expect(String((fetchMock.mock.calls[0] as any[])[0])).toBe('https://api.example/config');
  });

  test('a rotated api wallet with no front-end rebuild is caught before anything is signed', async () => {
    const cfg = await loadConfig({ NEXT_PUBLIC_NPC_API: 'https://api.example', NEXT_PUBLIC_NPC_TIP_WALLET: BUILD_WALLET });
    (globalThis as any).fetch = jest.fn(async () => res(200, { body: { tipWallet: API_WALLET, mint: null, cluster: 'mainnet-beta' } }));
    const out = await cfg.checkTipDestination();
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe('mismatch');
  });

  test('a dead api refuses the tip rather than guessing', async () => {
    const cfg = await loadConfig({ NEXT_PUBLIC_NPC_API: 'https://api.example', NEXT_PUBLIC_NPC_TIP_WALLET: API_WALLET });
    (globalThis as any).fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
    const out = await cfg.checkTipDestination();
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe('unreachable');
  });
});
