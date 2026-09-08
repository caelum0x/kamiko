/**
 * useWalletLink.ts — the wallet handshake and the streak saver, headless.
 *
 * WHY THIS EXISTS.
 * These two are the revenue and retention halves of the funnel, and they only existed inside
 * game.tsx's render. When the clicker moved onto the avatar screen the leaderboard, quests and the
 * contract came with it and these did not, so the panel could show you a leaderboard you had no way
 * to claim your place on. "The whole game on the same page" is not the whole game without the
 * button that turns a device id into a wallet.
 *
 * THE RULES, kept intact from game.tsx because each is load-bearing:
 *
 *   - GUEST TAPS ARE CLAIMED WITH A SESSION, NEVER A BARE ADDRESS. /claim MOVES SCORE, and a public
 *     key is public — it is printed on the leaderboard. So the claim carries the token
 *     /auth/verify minted. Without one the connect still stands and the taps stay on the device id;
 *     it is a smaller outcome, not a silent failure, and the message says which happened.
 *   - A FAILED CLAIM DOES NOT FAIL THE CONNECT. The wallet is linked either way and the claim is
 *     retried on the next connect. Throwing here would make a network blip look like a rejected
 *     signature.
 *   - PERMISSION IS ASKED ON THE BUTTON, NEVER ON LOAD. Whether the streak saver can be OFFERED is
 *     a client-side question (browser support, a configured VAPID key, permission not already
 *     denied); asking for it is not. An unprompted permission dialog is penalised by every browser
 *     and outright blocked by some.
 */
import { useCallback, useEffect, useState } from 'react';
import { API, apiDeadline } from './config.ts';
import { connectWallet, provider, sessionHeaders, shortAddr } from './identity.ts';
import { hasSubscription, pushOfferable, subscribeToStreakSaver } from './push.ts';

export interface WalletLink {
  /** Human-readable state of the last connect attempt. Empty before one is made. */
  walletMsg: string;
  connect: () => Promise<void>;
  /** Can the streak saver be offered at all in this browser and this deployment? */
  pushOffer: boolean;
  /** Is a subscription already in place? */
  pushArmed: boolean;
  pushMsg: string;
  armStreakSaver: () => Promise<void>;
}

export interface WalletLinkOptions {
  device: string;
  wallet: string;
  setWallet: (w: string) => void;
  /** Called after a successful connect: the `connect` quest completes server-side that instant. */
  onLinked?: () => void;
}

export function useWalletLink({ device, wallet, setWallet, onLinked }: WalletLinkOptions): WalletLink {
  const [walletMsg, setWalletMsg] = useState('');
  const [pushOffer, setPushOffer] = useState(false);
  const [pushArmed, setPushArmed] = useState(false);
  const [pushMsg, setPushMsg] = useState('');

  useEffect(() => {
    setPushOffer(pushOfferable());
    hasSubscription().then(setPushArmed).catch(() => setPushArmed(false));
  }, []);

  const connect = useCallback(async () => {
    const p = provider();
    if (!p) {
      setWalletMsg('Phantom not found — opening install…');
      window.open('https://phantom.app/', '_blank', 'noopener');
      return;
    }
    let w = '';
    let session = '';
    try {
      setWalletMsg('sign the message to verify…');
      ({ wallet: w, session } = await connectWallet(p));
    } catch {
      setWalletMsg('connect cancelled');
      return;
    }
    setWallet(w);
    let claimed = 0;
    if (session) {
      try {
        const c = await (await fetch(API + '/claim', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...sessionHeaders(session) },
          signal: apiDeadline(),
          body: JSON.stringify({ wallet: w, device }),
        })).json();
        claimed = Number(c?.claimed) || 0;
      } catch {
        /* the connect stands; the claim is retried on the next connect */
      }
    }
    setWalletMsg(
      '✅ ' + shortAddr(w) + ' connected' +
      (claimed > 0 ? ' · claimed ' + claimed.toLocaleString() + ' taps' : session ? '' : ' · guest taps not claimed'),
    );
    onLinked?.();
  }, [device, setWallet, onLinked]);

  const armStreakSaver = useCallback(async () => {
    setPushMsg('asking your browser…');
    const r = await subscribeToStreakSaver({ wallet, device });
    if (r.ok) {
      setPushArmed(true);
      setPushMsg(r.alreadySubscribed
        ? "✅ still armed — she'll nudge you before your streak lapses."
        : "✅ armed. she'll nudge you before your streak lapses.");
      return;
    }
    setPushMsg(r.why);
  }, [wallet, device]);

  return { walletMsg, connect, pushOffer, pushArmed, pushMsg, armStreakSaver };
}
