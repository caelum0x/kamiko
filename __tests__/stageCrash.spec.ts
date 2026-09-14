/**
 * stageCrash.spec.ts — the sentence a visitor gets when the stage falls over.
 *
 * This is a copy decision with a truth condition, which is a strange thing to unit-test until you
 * look at what the wrong branch does: it tells somebody whose browser has no WebGL to "try again",
 * which re-throws on click, or tells somebody behind a flaky connection that their device is out of
 * memory. The classifier is the whole difference between a page that helps and a page that guesses.
 *
 * The inputs below are the shapes these errors really arrive in — three.js throwing a bare string,
 * webpack's ChunkLoadError, a rejected fetch, a plain object from a worker — because
 * `error instanceof Error` is false for half of them and that is exactly where a naive classifier
 * gives up and says "unknown".
 */
import { describe, expect, it } from '@jest/globals';

import { classifyCrash, crashText, type CrashKind } from '@/features/stage/crash';

const kindOf = (e: unknown): CrashKind => classifyCrash(e).kind;

describe('reading a thrown value', () => {
  it('reads a real Error', () => {
    expect(crashText(new TypeError('Failed to fetch'))).toContain('failed to fetch');
    expect(crashText(new TypeError('Failed to fetch'))).toContain('typeerror');
  });

  it('reads a bare string — three.js throws several', () => {
    expect(crashText('Error creating WebGL context.')).toContain('webgl');
  });

  it('reads a plain object, which String() would flatten to "[object Object]"', () => {
    // A worker postMessage or a rejected non-Error: the fields are read individually for this case.
    expect(crashText({ code: 'ERR_NETWORK', reason: 'load failed' })).toBe('err_network load failed');
  });

  it('survives null and undefined rather than throwing inside the error handler', () => {
    expect(crashText(null)).toBe('');
    expect(crashText(undefined)).toBe('');
    expect(kindOf(null)).toBe('unknown');
  });
});

describe('the four failures this stage actually has', () => {
  it('no WebGL — the one where "try again" would be a lie', () => {
    for (const e of [
      'Error creating WebGL context.',
      new Error('THREE.WebGLRenderer: Error creating WebGL context.'),
      new Error('WebGL context lost'),
      { name: 'Error', message: 'Could not create a WebGL2 context' },
    ]) {
      expect(kindOf(e)).toBe('webgl');
    }
    // Re-mounting the same tree on a device that cannot do WebGL throws again on click.
    expect(classifyCrash('Error creating WebGL context.').canRetry).toBe(false);
  });

  it('a chunk that is gone — classified before the network, because it LOOKS like a network error', () => {
    /*
     * This is the ordering the module header calls load-bearing. A ChunkLoadError's message names
     * both a chunk and a failed fetch; classified as `network` it would offer "try again", which
     * re-requests the same missing file from the same stale build. Reload is the only fix, and it
     * is the only one offered.
     */
    const chunk = new Error('Loading chunk 4821 failed. (error: https://kamiko.fun/_next/static/chunks/4821.js)');
    chunk.name = 'ChunkLoadError';
    expect(kindOf(chunk)).toBe('chunk');
    expect(classifyCrash(chunk).canRetry).toBe(false);
    expect(kindOf(new Error('Failed to fetch dynamically imported module'))).toBe('chunk');
  });

  it('out of memory — classified before WebGL, so the advice is "close tabs" and not "your browser cannot do 3D"', () => {
    // A GPU allocation failure names WebGL too. The useful half of the sentence is the memory half.
    expect(kindOf(new RangeError('Array buffer allocation failed'))).toBe('memory');
    expect(kindOf('WebGL: out of memory')).toBe('memory');
    expect(classifyCrash('out of memory').canRetry).toBe(false);
  });

  it('a transient fetch failure — the ONE case where re-mounting in place is the right offer', () => {
    expect(kindOf(new TypeError('Failed to fetch'))).toBe('network');
    expect(kindOf(new Error('NetworkError when attempting to fetch resource.'))).toBe('network');
    expect(kindOf({ message: 'timed out loading AvatarSample_B.vrm' })).toBe('network');
    expect(classifyCrash(new TypeError('Failed to fetch')).canRetry).toBe(true);
  });

  it('anything else is honestly unknown, and retryable', () => {
    const copy = classifyCrash(new Error('Cannot read properties of undefined (reading "humanoid")'));
    expect(copy.kind).toBe('unknown');
    expect(copy.canRetry).toBe(true);
  });
});

describe('every branch is a complete piece of copy', () => {
  it('no branch can return an empty title or detail', () => {
    const cases: unknown[] = [
      'Error creating WebGL context.',
      new Error('ChunkLoadError: Loading chunk 1 failed'),
      new Error('out of memory'),
      new TypeError('Failed to fetch'),
      new Error('something nobody predicted'),
      null,
    ];
    const empty = cases
      .map((e) => classifyCrash(e))
      .filter((c) => c.title.trim() === '' || c.detail.trim() === '');
    expect(empty).toEqual([]);
  });

  it('the detail always tells the visitor what to DO, not just that something broke', () => {
    // The old-fashioned failure here is a page that says "an error occurred" and stops. Each branch
    // has to name an action; these are the words each one's advice hangs on.
    const advice = [
      ['Error creating WebGL context.', /hardware acceleration/i],
      [new Error('ChunkLoadError'), /reload/i],
      [new Error('out of memory'), /closing other tabs/i],
      [new TypeError('Failed to fetch'), /trying again/i],
      [new Error('nobody predicted this'), /trying again/i],
    ] as const;
    for (const [error, expected] of advice) {
      expect(classifyCrash(error).detail).toMatch(expected);
    }
  });
});
