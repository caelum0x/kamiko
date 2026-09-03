/**
 * tip.spec.ts — the money path. The four-way refusal contract, the amount bounds, and the settle
 * loop's three exits.
 *
 * WHY THIS FILE EXISTS: tip.ts's own header says "a money surface that only fails inside a browser
 * is a money surface nothing can check". The SERVER half of the same contract is tested
 * (services/game-api/tip-outcome.test.ts); this half decided whether a user who has ALREADY
 * broadcast SOL is told they were credited, and nothing held it in place. A one-character change to
 * `b.alreadyCredited === true` turns a credited tip into a permanent "NOT credited" on screen — or,
 * the direction that costs the user their evidence, clears the pending signature on a refusal that
 * was retryable.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  MAX_TIP_WAIT_MS, checkTipAmount, clearPending, loadPending, savePending, settleTip, tipOutcome, topicRefusal,
  type PendingTip,
} from '../tip.ts';

const WALLET = 'AaBbCcDdEeFfGgHhJjKkLmNnPpQqRrSsTtUuVvWwXxYy';
const SIG = '5'.repeat(88);

const pending = (over: Partial<PendingTip> = {}): PendingTip =>
  ({ wallet: WALLET, sol: 0.5, sig: SIG, message: '', firstSeen: 1_000_000, ...over });

/** What `postTip` actually sees: a status, and a body it may or may not be able to parse. */
function apiSays(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  clearPending();
  process.env.NEXT_PUBLIC_NPC_API = 'https://api.example';
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  clearPending();
});

describe('tipOutcome — what npc-api\'s answer means', () => {
  test('200 + ok:true + verified:true is a verified, credited tip', () => {
    const o = tipOutcome({ ok: true, status: 200 }, { ok: true, verified: true });
    expect(o).toEqual({ credited: true, verified: true, retryable: false, retryAfterSec: 0, reason: '' });
  });

  test('200 + ok:true WITHOUT verified is credited but NOT verified — the page must not dress it up', () => {
    const o = tipOutcome({ ok: true, status: 200 }, { ok: true });
    expect(o.credited).toBe(true);
    expect(o.verified).toBe(false);
  });

  test('409 + alreadyCredited:true means the tip landed — a retry after a lost response is not a failure', () => {
    const o = tipOutcome({ ok: false, status: 409 }, { error: 'duplicate signature', alreadyCredited: true });
    expect(o).toEqual({ credited: true, verified: true, retryable: false, retryAfterSec: 0, reason: '' });
  });

  test("409 + alreadyCredited:false is somebody else's row, and stays a terminal refusal", () => {
    const o = tipOutcome({ ok: false, status: 409 }, { error: 'signature already credited', alreadyCredited: false });
    expect(o.credited).toBe(false);
    expect(o.retryable).toBe(false);
    expect(o.reason).toBe('signature already credited');
  });

  test('402 is a DECISION about the chain — terminal, never retried', () => {
    const o = tipOutcome({ ok: false, status: 402 }, { error: 'no matching transfer' });
    expect(o.credited).toBe(false);
    expect(o.retryable).toBe(false);
    expect(o.retryAfterSec).toBe(0);
    expect(o.reason).toBe('no matching transfer');
  });

  test('403 is a lapsed session, not a verdict on the transfer — and it is not retryable on its own', () => {
    const o = tipOutcome({ ok: false, status: 403 }, { error: 'no session' });
    expect(o.credited).toBe(false);
    expect(o.retryable).toBe(false);
  });

  test('202 is retryable when the api says so — the RPC has simply not indexed it yet', () => {
    const o = tipOutcome({ ok: true, status: 202 }, { ok: false, retryable: true, retryAfterSec: 4, error: 'not indexed yet' });
    expect(o.credited).toBe(false);
    expect(o.retryable).toBe(true);
    expect(o.retryAfterSec).toBe(4);
    expect(o.reason).toBe('not indexed yet');
  });

  test('a 5xx, a 408 and a 429 are retryable even when the body claims otherwise', () => {
    for (const status of [500, 502, 503, 408, 429]) {
      const o = tipOutcome({ ok: false, status }, { error: 'x', retryable: false });
      expect(o.retryable).toBe(true);
      expect(o.credited).toBe(false);
    }
  });

  test('no response at all is retryable — we could not read an answer to trust', () => {
    const o = tipOutcome(null, null);
    expect(o).toEqual({ credited: false, verified: false, retryable: true, retryAfterSec: 5, reason: 'the api did not answer' });
  });

  test('an unreadable body from a refusal still names the status', () => {
    expect(tipOutcome({ ok: false, status: 418 }, null).reason).toBe('the api answered HTTP 418');
  });

  test('retryAfterSec is clamped to 1..60 and defaults to 5', () => {
    expect(tipOutcome({ ok: false, status: 503 }, { retryAfterSec: 9999 }).retryAfterSec).toBe(60);
    expect(tipOutcome({ ok: false, status: 503 }, { retryAfterSec: 0.1 }).retryAfterSec).toBe(1);
    expect(tipOutcome({ ok: false, status: 503 }, { retryAfterSec: -4 }).retryAfterSec).toBe(5);
    expect(tipOutcome({ ok: false, status: 503 }, { retryAfterSec: 'soon' }).retryAfterSec).toBe(5);
    expect(tipOutcome({ ok: false, status: 503 }, {}).retryAfterSec).toBe(5);
  });

  test('a 200 whose body does NOT say ok:true is not a credited tip', () => {
    // The direction that matters: a proxy or a cache that answers 200 with something else must
    // never be read as "you were credited".
    const o = tipOutcome({ ok: true, status: 200 }, { hello: 'world' });
    expect(o.credited).toBe(false);
  });
});

describe('checkTipAmount — the bounds that run before the wallet opens', () => {
  test('an ordinary amount passes with no confirmation', () => {
    expect(checkTipAmount('0.1')).toEqual({ ok: true, sol: 0.1, confirm: false });
    expect(checkTipAmount(' 0.25 ')).toEqual({ ok: true, sol: 0.25, confirm: false });
  });

  test('an unparseable or non-positive amount is refused', () => {
    for (const raw of ['', '   ', 'abc', '0', '-1', 'NaN']) {
      const out = checkTipAmount(raw);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.why).toContain('above zero');
    }
  });

  test('below the floor is refused with the floor named', () => {
    const out = checkTipAmount('0.001', { min: 0.01, max: 10, confirmAt: 1 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.why).toContain('0.01');
  });

  test('ABOVE THE CEILING IS REFUSED — the fat-finger case, nothing is built', () => {
    const out = checkTipAmount('100', { min: 0.01, max: 10, confirmAt: 1 });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.why).toContain('10');
      expect(out.why).toContain('nothing left your wallet');
    }
  });

  test('the ceiling is inclusive and the confirm threshold is inclusive', () => {
    expect(checkTipAmount('10', { min: 0.01, max: 10, confirmAt: 1 })).toEqual({ ok: true, sol: 10, confirm: true });
    expect(checkTipAmount('1', { min: 0.01, max: 10, confirmAt: 1 })).toEqual({ ok: true, sol: 1, confirm: true });
    expect(checkTipAmount('0.999', { min: 0.01, max: 10, confirmAt: 1 })).toEqual({ ok: true, sol: 0.999, confirm: false });
  });

  test('an amount that does not fully parse is refused, never truncated', () => {
    // Two failures at once. `parseFloat('100abc')` is 100 and `parseFloat('1e')` is 1 — an amount
    // we had to guess at is not one to send irreversibly. And `NaN > max` is false, so a naive
    // ceiling check would wave the unparseable value straight past the cap.
    for (const raw of ['1e', '100abc', '0.5 SOL', '1,000']) {
      const out = checkTipAmount(raw, { min: 0.01, max: 10, confirmAt: 1 });
      expect(out.ok).toBe(false);
    }
  });

  test('a large-but-legal amount is accepted and flagged for a second press', () => {
    const out = checkTipAmount('5', { min: 0.01, max: 10, confirmAt: 1 });
    expect(out).toEqual({ ok: true, sol: 5, confirm: true });
  });
});

describe('the pending record', () => {
  test('survives a round trip and is dropped when it is not a usable record', () => {
    expect(loadPending()).toBeNull();
    savePending(pending());
    expect(loadPending()).toEqual(pending());
    localStorage.setItem('npc_pending_tip', '{not json');
    expect(loadPending()).toBeNull();
    localStorage.setItem('npc_pending_tip', JSON.stringify({ wallet: WALLET }));
    expect(loadPending()).toBeNull();
  });
});

describe('settleTip — the three exits', () => {
  test('a credited tip clears the pending record', async () => {
    savePending(pending());
    (globalThis as any).fetch = jest.fn(async () => apiSays(200, { ok: true, verified: true }));
    const attempts: number[] = [];
    const r = await settleTip(pending(), (a) => attempts.push(a));
    expect(r).toEqual({ kind: 'credited', verified: true });
    expect(loadPending()).toBeNull();
    expect(attempts).toEqual([1]);
  });

  test('a 409 + alreadyCredited is reported as credited, not as a failure', async () => {
    savePending(pending());
    (globalThis as any).fetch = jest.fn(async () => apiSays(409, { error: 'duplicate', alreadyCredited: true }));
    expect(await settleTip(pending(), () => {})).toEqual({ kind: 'credited', verified: true });
    expect(loadPending()).toBeNull();
  });

  test('A TERMINAL 402 STOPS THE LOOP AND CLEARS THE PENDING RECORD', async () => {
    savePending(pending());
    const fetchMock = jest.fn(async () => apiSays(402, { error: 'no matching transfer' }));
    (globalThis as any).fetch = fetchMock as any;
    const r = await settleTip(pending(), () => {});
    expect(r).toEqual({ kind: 'not-credited', why: 'no matching transfer' });
    // Exactly one attempt: retrying a decision is noise, and the loop must not spin on it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(loadPending()).toBeNull();
  });

  test('A 403 KEEPS THE PENDING RECORD — a lapsed session is not a verdict on the transfer', async () => {
    savePending(pending());
    (globalThis as any).fetch = jest.fn(async () => apiSays(403, { error: 'no session' }));
    const r = await settleTip(pending(), () => {});
    expect(r).toEqual({ kind: 'keep-checking', why: 'this wallet is not signed in any more' });
    // The signature is the user's only proof of a transfer that really happened. It stays.
    expect(loadPending()).toEqual(pending());
  });

  test('past MAX_TIP_WAIT_MS it gives up asking but KEEPS the signature', async () => {
    savePending(pending());
    (globalThis as any).fetch = jest.fn(async () => apiSays(503, { error: 'verification unavailable' }));
    const now = () => 1_000_000 + MAX_TIP_WAIT_MS + 1;
    const r = await settleTip(pending(), () => {}, now);
    expect(r).toEqual({ kind: 'keep-checking', why: 'verification unavailable' });
    expect(loadPending()).toEqual(pending());
  });

  test('a retryable refusal is retried, and a later success still credits it', async () => {
    jest.useFakeTimers();
    savePending(pending());
    const fetchMock = jest
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(apiSays(202, { ok: false, retryable: true, retryAfterSec: 1, error: 'not indexed yet' }))
      .mockResolvedValueOnce(apiSays(200, { ok: true, verified: true }));
    (globalThis as any).fetch = fetchMock as any;
    const attempts: number[] = [];
    const settled = settleTip(pending(), (a) => attempts.push(a), () => 1_000_000);
    // The loop sleeps between attempts; drive the clock rather than waiting on it.
    await jest.advanceTimersByTimeAsync(30_000);
    expect(await settled).toEqual({ kind: 'credited', verified: true });
    expect(attempts).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(loadPending()).toBeNull();
  });

  test('a thrown fetch is a retryable attempt, not a terminal refusal', async () => {
    jest.useFakeTimers();
    savePending(pending());
    const fetchMock = jest
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(apiSays(200, { ok: true, verified: true }));
    (globalThis as any).fetch = fetchMock as any;
    const settled = settleTip(pending(), () => {}, () => 1_000_000);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(await settled).toEqual({ kind: 'credited', verified: true });
    expect(loadPending()).toBeNull();
  });

  test('the POST carries the session token for the tipping wallet', async () => {
    localStorage.setItem('npc_session:' + WALLET, 'a'.repeat(64));
    const fetchMock = jest.fn(async () => apiSays(200, { ok: true, verified: true }));
    (globalThis as any).fetch = fetchMock as any;
    await settleTip(pending(), () => {});
    const init = (fetchMock.mock.calls[0] as any[])[1];
    // npc-api credits the wallet whose SESSION sent the tip, never the address in the body.
    expect(init.headers['x-npc-session']).toBe('a'.repeat(64));
    expect(JSON.parse(init.body)).toEqual({ wallet: WALLET, sol: 0.5, sig: SIG, message: '' });
    localStorage.removeItem('npc_session:' + WALLET);
  });
});

describe('topicRefusal — "too low a tier" and "we could not read your tier" are different sentences', () => {
  test('a tier that could not be READ fails closed and invites a retry', () => {
    const s = topicRefusal(403, { tierStatus: 'error' });
    expect(s).toContain('fails closed');
    expect(s).toContain('try again');
  });

  test('a pre-launch token says there is no tier yet, not that the holder is too poor', () => {
    expect(topicRefusal(403, { tierStatus: 'disabled' })).toContain('has not launched yet');
  });

  test('a real tier refusal names the tier the holder actually has', () => {
    expect(topicRefusal(403, { tier: 'ghost' })).toContain('you are ghost');
  });

  test('a bare 403 is a lapsed session', () => {
    expect(topicRefusal(403, {})).toContain('connect again first');
  });

  test('400, 413 and 429 each say what to do about it', () => {
    expect(topicRefusal(400, {})).toContain('actual topic');
    expect(topicRefusal(413, {})).toContain('120 characters');
    expect(topicRefusal(429, { retryAfterSec: 7 })).toContain('(7s)');
  });

  test('an unrecognised status falls back to the api\'s own words, then to the status', () => {
    expect(topicRefusal(500, { error: 'db is down' })).toBe('db is down');
    expect(topicRefusal(500, null)).toBe('the api answered 500 — nothing was queued.');
  });
});
