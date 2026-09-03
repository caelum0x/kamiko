/**
 * airiQueue.spec.ts — the one local divergence from upstream airi's stream-kit queue.
 *
 * It lives beside the other $NPC funnel specs rather than next to src/utils/airiQueue.ts because it
 * is not a test OF upstream's queue — upstream ships its own suite. It pins the ONE behaviour this
 * repo added on top: `clear()` hands the undrained items back, which is what makes game.tsx's
 * unmount comment ("an unmount mid-flush must not silently lose taps the player made") true. Before
 * it, `clear()` returned void and emitted nothing, the `error` event that restores a batch only
 * fires from `drain`'s catch, and the taps were dropped while the comment claimed otherwise.
 */
import { describe, expect, test } from '@jest/globals';

import { createQueue } from '../../utils/airiQueue.ts';

describe('createQueue.clear', () => {
  test('HANDS BACK the batches that were still waiting, so the caller can put them on its own pile', async () => {
    let release: (() => void) | null = null;
    const started: number[] = [];
    const q = createQueue<number>({
      handlers: [async ({ data }) => {
        started.push(data);
        // Park the first batch in flight, which is exactly the state an unmount interrupts.
        await new Promise<void>((r) => { release = r; });
      }],
    });

    q.enqueue(10);
    q.enqueue(20);
    q.enqueue(30);
    expect(started).toEqual([10]);
    expect(q.length()).toBe(2);

    const left = q.clear();
    // 20 and 30 never started and are recoverable. 10 is IN FLIGHT — the server may already have
    // accepted it, so returning it would double-count the taps this page promises are real.
    expect(left).toEqual([20, 30]);
    expect(q.length()).toBe(0);
    expect(q.clear()).toEqual([]);
    release!();
  });

  test('a fully drained queue gives back nothing', async () => {
    const seen: number[] = [];
    const q = createQueue<number>({ handlers: [async ({ data }) => { seen.push(data); }] });
    const drained = new Promise<void>((r) => q.on('drain', r));
    q.enqueue(1);
    q.enqueue(2);
    await drained;
    expect(seen).toEqual([1, 2]);
    expect(q.clear()).toEqual([]);
  });

  test('a failed batch still reaches the error listener — the retry path is unchanged', async () => {
    const restored: number[] = [];
    const q = createQueue<number>({ handlers: [async () => { throw new Error('/wake answered HTTP 502'); }] });
    q.on('error', (n) => { restored.push(n as number); });
    const drained = new Promise<void>((r) => q.on('drain', r));
    q.enqueue(7);
    await drained;
    expect(restored).toEqual([7]);
  });
});
