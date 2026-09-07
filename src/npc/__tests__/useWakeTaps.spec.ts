/**
 * useWakeTaps.spec.ts — the pure core of the tap engine.
 *
 * These four functions decide the numbers this product publishes about itself: the wake meter the
 * avatar screen and /game both render, the idle decay, how many carried taps a restore may credit
 * to the GLOBAL counter, and how long a 429 parks every call the page makes. Each of them has a
 * direction it must fail in, and that direction is what is asserted here — not the happy path,
 * which was never the thing that broke.
 */
import { describe, expect, it } from '@jest/globals';
import {
  MAX_CARRIED_TAPS,
  WAKE_BATCH,
  backoffMsFor,
  carriedTaps,
  decayAwake,
  nextAwake,
} from '../useWakeTaps.ts';
import { MAX_BACKOFF_MS } from '../config.ts';

describe('nextAwake — the wake curve', () => {
  it('never exceeds 100, however hard she is tapped', () => {
    let a = 0;
    for (let i = 0; i < 5000; i++) a = nextAwake(a);
    expect(a).toBe(100);
  });

  it('slows down past 90, so "fully awake" is arrived at rather than mashed out', () => {
    // The last stretch is the reward. If it moved at the early rate, two seconds of tapping would
    // reach 100 and the meter would stop meaning anything.
    const early = nextAwake(10) - 10;
    const late = nextAwake(95) - 95;
    expect(late).toBeLessThan(early);
    expect(late).toBeGreaterThan(0); // still progress — a stalled meter reads as broken
  });

  it('treats a corrupted stored value as zero rather than propagating NaN', () => {
    // `awake` is restored from localStorage. A NaN here renders a meter with width: NaN% and every
    // later tap keeps it NaN — the bar silently disappears and never comes back.
    expect(nextAwake(Number.NaN)).toBe(1.4);
    expect(nextAwake(undefined as unknown as number)).toBe(1.4);
  });
});

describe('decayAwake — the idle fall', () => {
  it('never goes below zero', () => {
    let a = 1;
    for (let i = 0; i < 50; i++) a = decayAwake(a);
    expect(a).toBe(0);
  });

  it('is slower than a single tap, so tapping always wins against the decay', () => {
    // If decay outran a tap the meter would fall while somebody was actively tapping, which reads
    // as the game being broken rather than as her getting sleepy.
    expect(100 - decayAwake(100)).toBeLessThan(nextAwake(0));
  });

  it('treats a corrupted value as zero', () => {
    expect(decayAwake(Number.NaN)).toBe(0);
  });
});

describe('carriedTaps — what a restore may add to the GLOBAL counter', () => {
  it('carries a real backlog', () => {
    expect(carriedTaps('250')).toBe(250);
    expect(carriedTaps(7)).toBe(7);
  });

  it('caps an absurd value instead of honouring it', () => {
    // This is the whole point of the clamp: the value comes from localStorage, which the player
    // owns. Without the cap, editing one key inflates the one number this product promises is the
    // server's.
    expect(carriedTaps(String(MAX_CARRIED_TAPS * 100))).toBe(MAX_CARRIED_TAPS);
  });

  it('fails toward ZERO for anything that is not a count', () => {
    // Never toward the stored number: the honest answer to "how many taps did you make" is not
    // "whatever you typed".
    for (const junk of ['', '   ', 'abc', '-5', null, undefined, {}, [], Number.NaN, Infinity, -Infinity]) {
      expect(carriedTaps(junk)).toBe(0);
    }
  });

  it('floors a fractional value rather than crediting a partial tap', () => {
    expect(carriedTaps('12.9')).toBe(12);
  });
});

describe('backoffMsFor — obeying a 429 rather than fighting it', () => {
  it('uses the wait the server asked for', () => {
    expect(backoffMsFor(5)).toBe(5000);
    expect(backoffMsFor('30')).toBe(30_000);
  });

  it('never returns "now" for a missing, zero or hostile value', () => {
    // A zero here would retry the request that was just refused, which is a client answering its
    // own rate limit by spending the rest of its budget on it.
    for (const junk of [0, -1, '', 'soon', null, undefined, Number.NaN]) {
      expect(backoffMsFor(junk)).toBeGreaterThanOrEqual(1000);
    }
  });

  it('caps an enormous but REAL value, so one bad header cannot park the page forever', () => {
    expect(backoffMsFor(60 * 60 * 24 * 365)).toBe(MAX_BACKOFF_MS);
  });

  it('treats Infinity as junk and retries soon, rather than as the longest possible wait', () => {
    // The two are different inputs and deserve different answers. A huge FINITE number is a server
    // saying something absurd, so it is capped. Infinity is not something a Retry-After header can
    // legally contain — it is a parse artefact — and honouring it as "wait the maximum" would park
    // every call the page makes on the strength of a malformed byte.
    expect(backoffMsFor(Infinity)).toBe(1000);
  });
});

describe('the batch size matches what npc-api will accept', () => {
  it('is 100, which is the clamp services/game-api applies to one /wake', () => {
    // Sending more is not an error the client would see: npc-api silently clamps, so a larger
    // batch would quietly DROP taps the player made and the local count would drift above the
    // server's forever.
    expect(WAKE_BATCH).toBe(100);
  });
});
