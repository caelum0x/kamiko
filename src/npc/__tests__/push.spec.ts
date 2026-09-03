/**
 * push.spec.ts — the streak-saver client's two fail-closed gates.
 *
 * services/game-api ships the entire server half of web push (webpush.ts, push.ts, push-admin.ts)
 * and it was unreachable until this client existed. Both of the rules tested here are the same rule
 * — NEVER OFFER A SUBSCRIPTION THAT CANNOT BE PUSHED TO — and both fail silently in a browser when
 * they break: a subscription minted against the wrong applicationServerKey is one the server can
 * never deliver to, and a worker registered at the wrong path is a plain 404 that leaves the feature
 * simply, invisibly absent on exactly the deployments that use a base path.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { setConfig } from 'next/config';
import { pushOfferable, pushSupported, swPath, vapidKeyBytes } from '../push.ts';

/*
 * `setConfig` is next/config's own setter — the one the Next runtime itself calls on boot. Driving
 * the real module beats mocking it: `swPath` is checked against the actual shape Next publishes,
 * so a change in that shape fails here instead of passing against a stand-in.
 */

/** A real uncompressed P-256 point: 65 bytes, 0x04 followed by the two coordinates. */
const VALID_VAPID = 'BAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8';
/** The same 64 bytes with a 0x03 (compressed-point) prefix — decodable, and not a VAPID key. */
const WRONG_PREFIX = 'AwABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8';
/** 32 bytes — the length of a PRIVATE VAPID key, the realistic paste-the-wrong-half mistake. */
const HALF_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

beforeEach(() => { setConfig(undefined as any); });
afterEach(() => { jest.restoreAllMocks(); setConfig(undefined as any); });

describe('vapidKeyBytes', () => {
  test('decodes a real base64url VAPID public key to its 65 raw bytes', () => {
    const out = vapidKeyBytes(VALID_VAPID);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out!.length).toBe(65);
    expect(out![0]).toBe(0x04);
    expect(out![64]).toBe(63);
  });

  test('tolerates surrounding whitespace, because an env var pasted by hand carries it', () => {
    expect(vapidKeyBytes('  ' + VALID_VAPID + '\n')!.length).toBe(65);
  });

  test('REFUSES a key of the wrong length — the private half is the realistic mistake', () => {
    expect(vapidKeyBytes(HALF_KEY)).toBeNull();
  });

  test('refuses a 65-byte value that is not an uncompressed point', () => {
    expect(vapidKeyBytes(WRONG_PREFIX)).toBeNull();
  });

  test('refuses empty and undecodable input rather than throwing inside a click handler', () => {
    expect(vapidKeyBytes('')).toBeNull();
    expect(vapidKeyBytes('   ')).toBeNull();
    expect(vapidKeyBytes('!!!! not base64 !!!!')).toBeNull();
    expect(vapidKeyBytes(undefined as unknown as string)).toBeNull();
  });

  test('handles the base64URL alphabet, not just base64', () => {
    // '-' and '_' are the two characters base64url substitutes; decoding them as-is throws.
    const urlSafe = VALID_VAPID.replace(/\+/g, '-').replace(/\//g, '_');
    expect(vapidKeyBytes(urlSafe)!.length).toBe(65);
  });
});

describe('swPath — the worker must be asked for where it is actually served', () => {
  test('is /sw.js when the app is served at the root', () => {
    expect(swPath()).toBe('/sw.js');
  });

  test('carries the basePath prefix, which a bare /sw.js would 404 under', () => {
    setConfig({ publicRuntimeConfig: { root: '/npc' } } as any);
    expect(swPath()).toBe('/npc/sw.js');
  });

  test('does not double the slash when the prefix carries one', () => {
    setConfig({ publicRuntimeConfig: { root: '/npc/' } } as any);
    expect(swPath()).toBe('/npc/sw.js');
  });

  test('falls back to the root path when the runtime config says nothing useful', () => {
    setConfig({} as any);
    expect(swPath()).toBe('/sw.js');
    setConfig({ publicRuntimeConfig: {} } as any);
    expect(swPath()).toBe('/sw.js');
    setConfig({ publicRuntimeConfig: { root: '' } } as any);
    expect(swPath()).toBe('/sw.js');
  });
});

describe('the offer gates', () => {
  test('a browser without a PushManager cannot be offered the streak saver', () => {
    // jsdom has no serviceWorker and no PushManager, which is exactly the shape of a browser that
    // cannot do web push. The offer must simply not render.
    expect(pushSupported()).toBe(false);
    expect(pushOfferable()).toBe(false);
  });
});
