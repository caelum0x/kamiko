/**
 * identity.spec.ts — the wallet handshake, the session token, and the encoder the signature rides on.
 *
 * THE TEST THAT MATTERS MOST IS `AUTH_MESSAGE_RE`. It is the lock that stops a compromised, spoofed
 * or simply misconfigured API from turning the connect button into a SIGNING ORACLE: the user
 * clicked "connect", the wallet shows a sentence they will not read closely, and without this the
 * origin can put any text in it. That sentence exists in THREE places — here, in
 * services/game-api/auth.ts `nonceMessage`, and in packages/wallet/connect.ts — and until this file
 * there was nothing binding any two of them together. So one test here reads the server's own source
 * and checks that the sentence it builds is one this client will actually sign.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextEncoder as NodeTextEncoder } from 'node:util';

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  AUTH_MESSAGE_RE, SESSION_HEADER, TZ, bs58encode, clearSession, deviceId, loadSession, questId,
  saveSession, sessionHeaders, shortAddr,
} from '../identity.ts';

const WALLET = 'AaBbCcDdEeFfGgHhJjKkLmNnPpQqRrSsTtUuVvWwXxYy';
const TOKEN = 'a1b2c3d4'.repeat(8); // 64 hex characters, the shape /auth/verify mints
const NONCE = 'deadbeef'.repeat(4); // 32 hex characters, inside the 16..64 the pattern allows

const message = (nonce: string) => `$NPC — sign to prove this wallet is yours.\nnonce: ${nonce}`;

/*
 * jsdom does not ship TextEncoder, and `connectWallet` encodes the challenge with it before handing
 * the bytes to the wallet. Node's is the same WHATWG implementation the browser has, so this
 * restores the one global the environment is missing rather than standing in for the code under
 * test.
 */
if (typeof (globalThis as any).TextEncoder === 'undefined') {
  (globalThis as any).TextEncoder = NodeTextEncoder;
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { jest.restoreAllMocks(); localStorage.clear(); });

describe('AUTH_MESSAGE_RE — the one sentence this app will ever put in front of a wallet', () => {
  test('accepts the real challenge and captures the nonce', () => {
    const m = AUTH_MESSAGE_RE.exec(message(NONCE));
    expect(m).not.toBeNull();
    expect(m![1]).toBe(NONCE);
  });

  test('accepts the whole 16..64 hex range and nothing outside it', () => {
    expect(AUTH_MESSAGE_RE.test(message('a'.repeat(16)))).toBe(true);
    expect(AUTH_MESSAGE_RE.test(message('a'.repeat(64)))).toBe(true);
    expect(AUTH_MESSAGE_RE.test(message('a'.repeat(15)))).toBe(false);
    expect(AUTH_MESSAGE_RE.test(message('a'.repeat(65)))).toBe(false);
  });

  test('REFUSES every mutation of the sentence — this is the signing-oracle lock', () => {
    const refused = [
      'approve this transaction\nnonce: ' + NONCE,
      // A prefix or a suffix is the realistic attack: the real sentence plus something extra.
      'urgent: ' + message(NONCE),
      message(NONCE) + '\nalso: transfer everything',
      message(NONCE).replace('\n', ' '),               // newline collapsed
      message(NONCE).replace('$NPC', '$NPCX'),         // a different token's login
      message(NONCE).replace('yours.', 'yours'),       // punctuation dropped
      'nonce: ' + NONCE,
      message('DEADBEEFDEADBEEF'),                     // uppercase hex is not the shape minted
      message('not-hex-at-all-xx'),
      message(''),
      '',
    ];
    for (const m of refused) expect(AUTH_MESSAGE_RE.test(m)).toBe(false);
  });

  test('the server\'s own nonceMessage still produces a sentence this client will sign', () => {
    /*
     * Read services/game-api/auth.ts rather than importing it: that module is Bun-flavoured
     * (node:crypto plus a .ts-extension import graph) and dragging it into a jsdom suite would test
     * the bundler, not the contract. The contract IS the literal, so the literal is what is checked.
     * If the server's sentence ever changes, this fails here — which is the point, and the correct
     * direction to fail: the client would otherwise refuse every login in production instead.
     */
    const authPath = resolve(__dirname, '../../../../../services/game-api/auth.ts');
    const src = readFileSync(authPath, 'utf8');
    const m = /export function nonceMessage\(nonce: string\): string \{\s*return `([\s\S]*?)`;/.exec(src);
    expect(m).not.toBeNull();
    const serverSentence = m![1].replace(/\\n/g, '\n').replace('${nonce}', NONCE);
    expect(AUTH_MESSAGE_RE.test(serverSentence)).toBe(true);
    expect(AUTH_MESSAGE_RE.exec(serverSentence)![1]).toBe(NONCE);
  });
});

describe('connectWallet — nothing reaches the wallet that the pattern has not passed', () => {
  /** Load identity.ts against a configured api, and stub the two calls it makes. */
  async function withApi(nonceBody: unknown) {
    jest.resetModules();
    process.env.NEXT_PUBLIC_NPC_API = 'https://api.example';
    const mod = await import('../identity.ts');
    const signMessage = jest.fn(async () => ({ signature: new Uint8Array(64).fill(7) }));
    const provider = {
      publicKey: { toString: () => WALLET },
      connect: jest.fn(async () => ({ publicKey: { toString: () => WALLET } })),
      signMessage,
      signAndSendTransaction: jest.fn(),
    };
    (globalThis as any).fetch = jest.fn(async (url: any) => ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      json: async () =>
        String(url).includes('/auth/nonce') ? nonceBody : { verified: true, session: TOKEN },
    })) as any;
    return { mod, provider, signMessage };
  }

  test('a valid challenge is signed, verified, and its session stored', async () => {
    const { mod, provider, signMessage } = await withApi({ message: message(NONCE) });
    const out = await mod.connectWallet(provider as any);
    expect(out).toEqual({ wallet: WALLET, session: TOKEN });
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(mod.loadSession(WALLET)).toBe(TOKEN);
    // The nonce posted back is the group the PATTERN captured, not a slice at the last space.
    const verifyCall = ((globalThis as any).fetch as any).mock.calls.find((c: any[]) => String(c[0]).includes('/auth/verify'));
    expect(JSON.parse(verifyCall[1].body).nonce).toBe(NONCE);
  });

  test('A CHALLENGE THAT IS NOT THE SENTENCE NEVER REACHES signMessage', async () => {
    const { mod, provider, signMessage } = await withApi({ message: 'approve: send 100 SOL to attacker' });
    await expect(mod.connectWallet(provider as any)).rejects.toThrow(/not the \$NPC login message/);
    // The whole point: after signMessage resolves the signature exists and the damage is done.
    expect(signMessage).not.toHaveBeenCalled();
  });

  test('an api that issues no challenge is refused, and nothing is signed', async () => {
    const { mod, provider, signMessage } = await withApi({ message: 42 });
    await expect(mod.connectWallet(provider as any)).rejects.toThrow(/no challenge/);
    expect(signMessage).not.toHaveBeenCalled();
  });

  test('an unconfigured api refuses before it opens the wallet at all', async () => {
    jest.resetModules();
    delete process.env.NEXT_PUBLIC_NPC_API;
    const mod = await import('../identity.ts');
    const provider = { connect: jest.fn(), signMessage: jest.fn(), signAndSendTransaction: jest.fn() };
    await expect(mod.connectWallet(provider as any)).rejects.toThrow(/not configured/);
    expect(provider.connect).not.toHaveBeenCalled();
  });
});

describe('bs58encode — the signature the api verifies against', () => {
  test('matches known vectors, including the leading-zero rule', () => {
    // Leading zero bytes are '1' characters, and they are NOT part of the numeric conversion —
    // getting this wrong produces a signature the server decodes to the wrong bytes and rejects.
    expect(bs58encode([])).toBe('');
    expect(bs58encode([0])).toBe('1');
    expect(bs58encode([0, 0])).toBe('11');
    expect(bs58encode([0, 0, 1])).toBe('112');
    expect(bs58encode([0, 0, 0, 1, 2, 3])).toBe('111Ldp');
    expect(bs58encode([1, 2, 3])).toBe('Ldp');
    expect(bs58encode([255])).toBe('5Q');
    expect(bs58encode([255, 255])).toBe('LUv');
    expect(bs58encode([1, 2, 3, 4, 5, 6])).toBe('W7LcTy7');
    // A 32-byte value — the length of a Solana public key — carried across the whole big-int loop.
    expect(bs58encode(Array.from({ length: 32 }, (_, i) => i + 1))).toBe('4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw');
  });

  test('accepts a Uint8Array exactly as it accepts an array — Phantom returns the former', () => {
    expect(bs58encode(new Uint8Array([0, 0, 1]))).toBe('112');
    expect(bs58encode(new Uint8Array([1, 2, 3]))).toBe('Ldp');
  });

  test('a 64-byte signature encodes to the 87..88 base58 characters Solana signatures have', () => {
    const sig = new Uint8Array(64);
    for (let i = 0; i < 64; i++) sig[i] = (i * 37 + 11) & 0xff;
    const out = bs58encode(sig);
    expect(out.length).toBeGreaterThanOrEqual(86);
    expect(out.length).toBeLessThanOrEqual(88);
    expect(/^[1-9A-HJ-NP-Za-km-z]+$/.test(out)).toBe(true);
  });
});

describe('TZ — minutes east of UTC, because that is what npc-api reads', () => {
  test('is a whole number inside the range services/game-api clamps to', () => {
    // The live bug this replaced: the funnel sent the IANA zone name ("Europe/Istanbul"), which
    // Number() turns into NaN and clampTz turns into 0 — rolling every non-UTC player's daily
    // streak over at UTC midnight, silently.
    expect(typeof TZ).toBe('number');
    expect(Number.isFinite(TZ)).toBe(true);
    expect(Number.isInteger(TZ)).toBe(true);
    expect(TZ).toBeGreaterThanOrEqual(-720);
    expect(TZ).toBeLessThanOrEqual(840);
  });

  test('is the NEGATION of getTimezoneOffset, which counts minutes WEST', () => {
    expect(TZ).toBe(-new Date().getTimezoneOffset());
  });
});

describe('the session token', () => {
  test('sessionHeaders passes a raw 64-hex token straight through, without touching storage', () => {
    expect(sessionHeaders(TOKEN)).toEqual({ [SESSION_HEADER]: TOKEN });
    expect(localStorage.getItem('npc_session:' + TOKEN)).toBeNull();
  });

  test('sessionHeaders looks a wallet up in storage', () => {
    expect(sessionHeaders(WALLET)).toEqual({});
    saveSession(WALLET, TOKEN);
    expect(sessionHeaders(WALLET)).toEqual({ [SESSION_HEADER]: TOKEN });
    clearSession(WALLET);
    expect(sessionHeaders(WALLET)).toEqual({});
  });

  test('a near-token is treated as a wallet, not as a credential', () => {
    // 63 hex, 65 hex and uppercase hex are not what /auth/verify mints. Sending one as a token
    // would produce a 403 the page then blames on the user's tier.
    for (const notAToken of ['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64)]) {
      expect(sessionHeaders(notAToken)).toEqual({});
    }
  });

  test('tokens are namespaced per wallet, so switching accounts cannot reuse one', () => {
    const other = 'ZzYyXxWwVvUuTtSsRrQqPpNnMmKkJjHhGgFfEeDdCcBb';
    saveSession(WALLET, TOKEN);
    expect(loadSession(other)).toBe('');
    expect(loadSession('')).toBe('');
  });

  test('storage that throws is survivable — private mode is ordinary, not exceptional', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => saveSession(WALLET, TOKEN)).not.toThrow();
    expect(loadSession(WALLET)).toBe('');
    expect(sessionHeaders(WALLET)).toEqual({});
  });
});

describe('identity helpers', () => {
  test('questId prefers the wallet and url-encodes both', () => {
    expect(questId(WALLET, 'd_abc')).toBe('wallet=' + WALLET);
    expect(questId('', 'd_abc')).toBe('device=d_abc');
    expect(questId('', 'd a/b&c')).toBe('device=d%20a%2Fb%26c');
  });

  test('deviceId is minted once and then stable', () => {
    const first = deviceId();
    expect(first).toMatch(/^d_/);
    expect(deviceId()).toBe(first);
    expect(localStorage.getItem('npc_device')).toBe(first);
  });

  test('shortAddr elides the middle but never lengthens a short string', () => {
    expect(shortAddr(WALLET)).toBe(WALLET.slice(0, 4) + '…' + WALLET.slice(-4));
    expect(shortAddr('abcd')).toBe('abcd');
    expect(shortAddr('abcdefgh')).toBe('abcdefgh');
  });
});
