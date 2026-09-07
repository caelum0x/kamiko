/**
 * identity.ts — who the visitor is, and the ONE wallet handshake every $KAMIKO surface uses.
 *
 * Two identities, on purpose:
 *   - a DEVICE id, minted locally, so a tapper with no wallet is still a real, resumable player;
 *   - a WALLET, proven by the ed25519 nonce/verify handshake in services/game-api/auth.ts, which
 *     mints the SESSION TOKEN.
 *
 * The token is the part that matters after connect. /claim, /tip and /perk authenticate the SESSION,
 * never the address in the request body — an address is public, it is printed on the leaderboard, so
 * anyone could post a stranger's address and be credited for their money. A page that connects and
 * forgets the token can never claim its guest taps and can never be credited for a tip it just paid
 * for. That is why `connectWallet` returns the token and stores it before it returns.
 *
 * This module is the single source for that flow inside amica. It used to be inlined in game.tsx;
 * the holder page needs the same handshake, and two copies of an auth flow is how they drift.
 */
import { API, apiDeadline } from './config.ts';

/**
 * THE ONLY SENTENCE THIS APP WILL EVER PUT IN FRONT OF A WALLET.
 *
 * `/auth/nonce` returns a challenge and this client signs it. Signing whatever an origin answers
 * with is how a compromised, spoofed or misconfigured API turns a login button into a signing
 * oracle: the user clicked "connect", the wallet shows a message they will not read closely, and
 * the site can put ANY text in it. packages/wallet/connect.ts locks the same shape for the same
 * reason (`AUTH_MESSAGE_RE`) and its header calls it the thing that "stops a page from signing
 * whatever that origin answers with"; the funnel's own copy of the handshake had no such lock.
 *
 * Kept byte-identical to services/game-api/auth.ts `nonceMessage` — a fixed sentence plus 16..64
 * hex characters. If that sentence ever changes, this refuses every login until it is changed here
 * too, which is the correct direction to fail.
 */
export const AUTH_MESSAGE_RE = /^\$KAMIKO — sign to prove this wallet is yours\.\nnonce: ([0-9a-f]{16,64})$/;

/** The header npc-api reads the session token from (services/game-api/auth.ts SESSION_HEADER). */
export const SESSION_HEADER = 'x-npc-session';
/** localStorage key prefix. Namespaced per wallet so switching accounts cannot reuse a token. */
export const SESSION_PREFIX = 'npc_session';

/**
 * The visitor's UTC offset in MINUTES east of UTC — the unit npc-api actually reads.
 *
 * services/game-api clamps `tz` to -720..840 and adds it as minutes (streaks.ts `dayNumber`:
 * `(tsMs + tzOffsetMinutes * 60_000) / 86_400_000`). The funnel used to send the IANA zone name
 * ("Europe/Istanbul") instead, which `Number(...)` turns into NaN and clampTz turns into 0 — so
 * every player's daily streak and daily quest rolled over at UTC midnight rather than their own,
 * silently breaking the streak for everyone far enough from UTC. It is a number, so we send a number.
 *
 * `getTimezoneOffset()` counts minutes WEST of UTC, so it is negated here.
 */
export const TZ = ((): number => {
  try { return -new Date().getTimezoneOffset(); } catch { return 0; }
})();

/* ------------------------------------------------------------------ *
 * Storage — never throws. Private mode and blocked site data are ordinary.
 * ------------------------------------------------------------------ */
export function readLocal(k: string): string {
  try { return (typeof localStorage !== 'undefined' && localStorage.getItem(k)) || ''; } catch { return ''; }
}
export function writeLocal(k: string, v: string): void {
  try { localStorage?.setItem(k, v); } catch { /* private mode: this tab still works, it just cannot persist */ }
}
export function removeLocal(k: string): void {
  try { localStorage?.removeItem(k); } catch { /* nothing to do */ }
}

/** A stable per-browser id, minted on first use. Client-only — call it after mount. */
export function deviceId(): string {
  let id = readLocal('npc_device');
  if (!id) {
    id = 'd_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    writeLocal('npc_device', id);
  }
  return id;
}

export const walletId = (): string => readLocal('npc_wallet');
export const setWalletId = (w: string): void => writeLocal('npc_wallet', w);

/** The `wallet=`/`device=` query npc-api resolves an identity from, wallet first. */
export const questId = (wallet: string, device: string): string =>
  wallet ? 'wallet=' + encodeURIComponent(wallet) : 'device=' + encodeURIComponent(device);

export const shortAddr = (w: string, lead = 4, tail = 4): string =>
  (w.length <= lead + tail ? w : `${w.slice(0, lead)}…${w.slice(-tail)}`);

/* ------------------------------------------------------------------ *
 * The session token
 * ------------------------------------------------------------------ */
const sessionKey = (wallet: string) => `${SESSION_PREFIX}:${wallet}`;

export const saveSession = (wallet: string, token: string): void => writeLocal(sessionKey(wallet), token);
export const loadSession = (wallet: string): string => (wallet ? readLocal(sessionKey(wallet)) : '');
export const clearSession = (wallet: string): void => removeLocal(sessionKey(wallet));

/**
 * The auth header for `wallet`, or `{}` when there is no session.
 *
 * Accepts a raw 64-hex token as well, so a caller that already holds the token from a just-completed
 * handshake does not have to round-trip it through storage that may be disabled.
 */
export function sessionHeaders(walletOrToken: string): Record<string, string> {
  const token = /^[0-9a-f]{64}$/.test(walletOrToken) ? walletOrToken : loadSession(walletOrToken);
  return token ? { [SESSION_HEADER]: token } : {};
}

/* ------------------------------------------------------------------ *
 * base58 — the encoding Solana signatures and addresses are written in
 * ------------------------------------------------------------------ */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function bs58encode(bytes: Uint8Array | number[]): string {
  const src = Array.from(bytes as ArrayLike<number>);
  const d: number[] = [0];
  for (const x of src) {
    let c = x;
    for (let j = 0; j < d.length; j++) { c += d[j] << 8; d[j] = c % 58; c = (c / 58) | 0; }
    while (c > 0) { d.push(c % 58); c = (c / 58) | 0; }
  }
  let s = '';
  for (let k = 0; k < src.length && src[k] === 0; k++) s += '1';
  // the numeric part is empty when the value is exactly zero (avoid a spurious leading digit)
  if (!(d.length === 1 && d[0] === 0)) {
    for (let i = d.length - 1; i >= 0; i--) s += B58[d[i]];
  }
  return s;
}

/* ------------------------------------------------------------------ *
 * The handshake
 * ------------------------------------------------------------------ */

/** The narrow slice of an injected wallet this module uses. Phantom satisfies it. */
export interface WalletProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(data: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array }>;
  signAndSendTransaction(tx: unknown): Promise<{ signature: string }>;
}

/** The browser's injected Solana provider, or null. */
export function provider(): WalletProvider | null {
  if (typeof window === 'undefined') return null;
  const p = (window as unknown as { solana?: WalletProvider }).solana;
  return p && typeof p.connect === 'function' ? p : null;
}

export interface ConnectResult {
  wallet: string;
  /** The session token, or '' when the handshake produced no token (the wallet is NOT signed in). */
  session: string;
}

/**
 * Connect → prove ownership → return the wallet AND its session token, already stored.
 *
 * Throws on cancellation or on any step the api refused, because every caller has a different thing
 * to say about it and none of them should proceed as if the wallet were verified.
 */
export async function connectWallet(p: WalletProvider): Promise<ConnectResult> {
  if (!API) throw new Error('the funnel api is not configured');
  const resp = await p.connect();
  const wallet: string = resp?.publicKey?.toString?.() || '';
  if (!wallet) throw new Error('the wallet returned no public key');

  const nonceRes = await fetch(API + '/auth/nonce?wallet=' + encodeURIComponent(wallet), { signal: apiDeadline() });
  const { message } = (await nonceRes.json()) as { message?: unknown };
  if (typeof message !== 'string' || !message) throw new Error('the api issued no challenge');

  // REFUSE ANYTHING THAT IS NOT THE ONE SENTENCE. This is the gate, and it is checked before the
  // bytes reach the wallet: after `signMessage` resolves the signature exists and the damage, if
  // there was any, is done.
  const match = AUTH_MESSAGE_RE.exec(message);
  if (!match) throw new Error('the api asked this wallet to sign something that is not the $KAMIKO login message — refused');

  const signed = await p.signMessage(new TextEncoder().encode(message), 'utf8');
  const verifyRes = await fetch(API + '/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: apiDeadline(),
    // The challenge is returned verbatim; the nonce is the hex group AUTH_MESSAGE_RE captured —
    // taken from the validated match rather than by slicing at the last space, so the value posted
    // back is one the pattern has already proven is a nonce.
    body: JSON.stringify({ wallet, signature: bs58encode(signed.signature), nonce: match[1] }),
  });
  const v = (await verifyRes.json()) as { verified?: unknown; session?: unknown };
  if (v?.verified !== true) throw new Error('the api did not verify that signature');

  const session = typeof v.session === 'string' ? v.session : '';
  if (session) saveSession(wallet, session);
  setWalletId(wallet);
  return { wallet, session };
}
