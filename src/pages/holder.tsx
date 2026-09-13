/**
 * holder.tsx — tier, perks, and the tip flow, living INSIDE the amica product.
 *
 * The funnel's holder dashboard was lost when apps/flagship-web was collapsed into amica: only the
 * game came across, so services/game-api's /me tier, POST /perk, POST /tip and /tips/leaderboard —
 * all shipped, all proxied by services/bridge — had no client at all. This is that surface, rebuilt
 * as a first-class amica route on the same origin the chat and the game already use.
 *
 * Two things on this page are gated and both fail CLOSED in the UI as well as on the server:
 *
 *   - THE SENTIENT PERK is shown only when npc-api's `tierActions` says this wallet may use it. That
 *     list is empty whenever the tier could not be read, so an RPC outage HIDES the control rather
 *     than offering a button that can only 403. The POST is re-checked server-side against a fresh
 *     chain read anyway; this is presentation, not the gate.
 *   - THE TIP REQUIRES A LIVE SESSION BEFORE ANY SOL MOVES. npc-api credits the wallet whose SESSION
 *     sent the tip, never an address in the body — the chain is public, so anyone could read a
 *     stranger's confirmed transfer off it and claim it. Signing first and discovering afterwards
 *     that we cannot be credited is exactly the failure this page exists to prevent.
 *
 * The tip destination is CONFIGURATION ONLY (src/npc/config.ts). It is never read from the URL: a
 * `?tip=` parameter would build and sign a REAL mainnet transfer to a stranger while the page said
 * the user had tipped $KAMIKO — and npc-api would then refuse to credit it, because it verifies the
 * destination. A money destination never comes from a link someone sent you.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { SeoHead } from '@/components/seoHead';
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

import { API, MAX_TIP_SOL, MIN_TIP_SOL, RPC, TIP_WALLET, apiDeadline, checkTipDestination, readJson } from '../npc/config.ts';

/**
 * Ceiling on the one RPC call this page makes (the recent blockhash for the tip transfer).
 * Shorter than the general API deadline: a blockhash is a single cheap read, and the user is
 * staring at a button waiting to be asked to sign.
 */
const BLOCKHASH_TIMEOUT_MS = 10_000;

/**
 * How long a "press Tip again to confirm" stays spendable. A confirmation is a statement about a
 * transfer the user is about to make right now; left armed indefinitely it becomes a one-click
 * large transfer waiting on a page nobody is looking at.
 */
const CONFIRM_WINDOW_MS = 60_000;
import { connectWallet, loadSession, provider, sessionHeaders, setWalletId, shortAddr, walletId } from '../npc/identity.ts';
import { checkTipAmount, clearPending, loadPending, savePending, settleTip, topicRefusal, type PendingTip } from '../npc/tip.ts';
import { NPC_CSS } from '../npc/styles.ts';

interface Me {
  taps?: number;
  rank?: number | null;
  tier?: { name: string; perks?: string[] } | null;
  tierActions?: string[] | null;
}

interface TipRow { wallet: string; total: number }
interface TopicRow { wallet?: string; topic: string; ts: number }

type Tone = '' | 'good' | 'warn' | 'bad';

export default function HolderPage() {
  const [wallet, setWallet] = useState('');
  const [connectMsg, setConnectMsg] = useState('');
  const [connecting, setConnecting] = useState(false);

  const [me, setMe] = useState<Me | null>(null);
  const [canSuggest, setCanSuggest] = useState(false);
  /** Why the tier on screen may not be current. '' when it was read cleanly. */
  const [tierNote, setTierNote] = useState('');

  const [topic, setTopic] = useState('');
  const [topicMsg, setTopicMsg] = useState('');
  const [topicBusy, setTopicBusy] = useState(false);
  const [myTopics, setMyTopics] = useState<TopicRow[] | null>(null);

  const [amount, setAmount] = useState('0.1');
  const [tipNote, setTipNote] = useState('');
  const [tipMsg, setTipMsg] = useState<ReactNode>('');
  const [tipTone, setTipTone] = useState<Tone>('');
  const [showRetry, setShowRetry] = useState(false);
  const [settling, setSettling] = useState(false);
  /**
   * A large tip that has been described to the user and is waiting for a SECOND press.
   *
   * It carries the amount it was armed for, so editing the field cancels it, and the moment it was
   * armed, so a confirmation left on screen while somebody made a coffee cannot be spent by an
   * accidental click twenty minutes later. Both are the same rule: the confirmation must belong to
   * the transfer that is actually about to happen.
   */
  const [armed, setArmed] = useState<{ sol: number; at: number } | null>(null);

  const [board, setBoard] = useState<{ total: number; rows: TipRow[] } | null>(null);

  // localStorage is client-only (Next.js SSR): resolve identity after mount.
  useEffect(() => { setWallet(walletId()); }, []);

  const say = (node: ReactNode, tone: Tone = '') => { setTipMsg(node); setTipTone(tone); };

  /* ---- your standing ------------------------------------------------- */
  const showYou = useCallback(async (w: string) => {
    try {
      const r = await readJson<Me>(API + '/me?wallet=' + encodeURIComponent(w));
      if (!r.ok) {
        // A THROTTLE IS NOT AN ANSWER ABOUT THIS WALLET. GET /me is rate-limited, and a 429 is
        // JSON — parsing it as a tier told a sentient-tier holder they were a "ghost" and hid the
        // perk they paid for. On a throttle we keep whatever we already knew and say so; on a real
        // failure we fall closed to "no tier read" below.
        if (r.throttled) {
          setTierNote('the api is rate-limiting this page — your tier is not being re-read right now.');
          return;
        }
        throw new Error('unreadable');
      }
      const j = r.data;
      setMe(j);
      setTierNote('');
      // `tierActions` is the machine-readable list npc-api will actually honour on POST /perk — the
      // same table the server gates on. Empty whenever the tier could not be read.
      setCanSuggest(Array.isArray(j.tierActions) && j.tierActions.includes('suggest-topic'));
    } catch {
      // /me did not answer: we do not know this wallet's tier, so we do not offer a tier-gated
      // control. Fail closed in the UI too — the alternative is a button that 403s.
      setMe(null);
      setTierNote('your tier could not be read just now, so tier-gated controls are hidden.');
      setCanSuggest(false);
    }
  }, []);

  useEffect(() => { if (wallet && API) showYou(wallet); }, [wallet, showYou]);

  const connect = useCallback(async (): Promise<string> => {
    const p = provider();
    if (!p) {
      setConnectMsg('Phantom not found — opening install…');
      window.open('https://phantom.app/', '_blank', 'noopener');
      return '';
    }
    setConnecting(true);
    setConnectMsg('sign the message to verify…');
    try {
      const { wallet: w, session } = await connectWallet(p);
      setWallet(w);
      setWalletId(w);
      setConnectMsg((session ? '✅ ' : '⚠️ ') + shortAddr(w) + (session ? ' connected' : ' connected, but no session — perks and tips need one'));
      return w;
    } catch {
      setConnectMsg('connect cancelled');
      return '';
    } finally {
      setConnecting(false);
    }
  }, []);

  /* ---- the sentient perk ---------------------------------------------- */
  const loadTopics = useCallback(async (w: string) => {
    try {
      const r = await readJson<{ topics?: TopicRow[] }>(API + '/topics?limit=20');
      // A throttle leaves the list exactly as it was rather than replacing it with "unavailable".
      if (!r.ok) { if (!r.throttled) setMyTopics(null); return; }
      const j = r.data;
      // Deliberately filtered to the connected wallet. /topics is the WHOLE queue, and a
      // sentient-tier holder is still a stranger typing into a box: rendering everyone's
      // submissions here would make this dashboard a place one holder can put a fake contract
      // address in front of another.
      const rows: TopicRow[] = Array.isArray(j?.topics) ? j.topics : [];
      setMyTopics(rows.filter((row) => row && row.wallet === w).slice(0, 5));
    } catch {
      setMyTopics(null);
    }
  }, []);

  useEffect(() => { if (canSuggest && wallet) loadTopics(wallet); }, [canSuggest, wallet, loadTopics]);

  const suggestTopic = async () => {
    const text = topic.trim();
    if (!wallet) { setTopicMsg('connect first.'); return; }
    if (!text) { setTopicMsg('type a topic first.'); return; }
    // Checked BEFORE the request: without the token npc-api answers 403 and the holder is left
    // wondering whether their tier is wrong, when the real answer is "sign in again".
    if (!loadSession(wallet)) {
      setTopicMsg('connect again first — a perk is spent by the wallet that proved ownership, and this session has expired.');
      return;
    }
    setTopicBusy(true);
    setTopicMsg('checking your $KAMIKO balance on-chain…');
    try {
      const res = await fetch(API + '/perk', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...sessionHeaders(wallet) },
        signal: apiDeadline(),
        body: JSON.stringify({ wallet, action: 'suggest-topic', topic: text }),
      });
      let body: any = null;
      try { body = await res.json(); } catch { body = null; }
      if (res.ok && body?.ok) {
        setTopic('');
        // Echo what npc-api STORED, not what was typed: it collapses whitespace and cuts at 120,
        // and the line she will read is the one that matters.
        setTopicMsg('✅ queued for the show: "' + String(body.topic || text) + '"');
        loadTopics(wallet);
      } else {
        setTopicMsg(topicRefusal(res.status, body));
      }
    } catch {
      setTopicMsg('could not reach the api — nothing was queued.');
    } finally {
      setTopicBusy(false);
    }
  };

  /* ---- the tip --------------------------------------------------------- */
  const loadBoard = useCallback(async () => {
    if (!API) { setBoard(null); return; }
    try {
      const r = await readJson<{ totalTips?: number; topTippers?: TipRow[] }>(API + '/tips/leaderboard?limit=8');
      // Same rule: a throttle keeps the board that is already on screen. Only a real failure blanks
      // it, because "tips unavailable" next to a total of 0 reads as "nobody has tipped".
      if (!r.ok) { if (!r.throttled) setBoard(null); return; }
      const j = r.data;
      setBoard({ total: Number(j?.totalTips) || 0, rows: Array.isArray(j?.topTippers) ? j.topTippers : [] });
    } catch {
      setBoard(null);
    }
  }, []);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  const sigLine = (lead: string, signature: string, tail = '') => (
    <>{lead}<code className="npcg-sig">{signature}</code>{tail}</>
  );

  const runSettle = useCallback(async (p: PendingTip) => {
    if (settling) return;
    setSettling(true);
    setShowRetry(false);
    try {
      const r = await settleTip(p, (attempt) =>
        say(attempt === 1
          ? 'sent — waiting for npc-api to verify it on-chain…'
          : `still verifying on-chain (attempt ${attempt})… your SOL is on its way, this can take a moment.`),
      );
      if (r.kind === 'credited') {
        // npc-api reports whether it CHECKED the transfer on-chain. Anything else is not a verified
        // tip and this page does not dress it up as one.
        if (r.verified) say(`✅ tipped ${p.sol} SOL — verified on-chain. she felt that.`, 'good');
        else say('⚠️ recorded, but npc-api did not verify it on-chain — it is not counted as a verified tip.', 'warn');
        loadBoard();
      } else if (r.kind === 'not-credited') {
        say(sigLine(`⚠️ your SOL was sent on-chain but was NOT credited: ${r.why}. save this signature — `, p.sig, ' — it is the only proof of the transfer.'), 'bad');
      } else {
        say(sigLine(`⏳ your SOL was sent on-chain and is NOT credited yet (${r.why}). it is saved — press the button below to check again. signature: `, p.sig), 'warn');
        setShowRetry(true);
      }
    } finally {
      setSettling(false);
    }
  }, [settling, loadBoard]);

  const tip = async () => {
    if (!wallet) { say('connect first.'); return; }
    // Bounds BEFORE anything else touches the network: an amount this page will not send is not
    // worth a round trip, and every refusal here happens while "nothing left your wallet" is true.
    const amt = checkTipAmount(amount);
    if (!amt.ok) { setArmed(null); say(amt.why, 'warn'); return; }
    const sol = amt.sol;
    if (!loadSession(wallet)) {
      say('connect again first — a tip is credited to the wallet that proved ownership, and this session has expired.', 'warn');
      return;
    }
    // A tip that is broadcast but not yet credited is not finished. Starting a second one would put
    // two unresolved signatures on this page and only one place to show them.
    const stuck = loadPending();
    if (stuck) {
      say(sigLine('⏳ an earlier tip is still unconfirmed — finish that one first. signature: ', stuck.sig), 'warn');
      setShowRetry(true);
      return;
    }
    const p = provider();
    if (!p) { say('Phantom not found.', 'bad'); return; }

    /*
     * THE DESTINATION IS CONFIRMED BY THE API BEFORE THE TRANSACTION IS BUILT.
     *
     * `TIP_WALLET` is NEXT_PUBLIC_NPC_TIP_WALLET, baked in at BUILD time; npc-api credits only a
     * transfer to its RUNTIME NPC_TIP_WALLET. Those are two different envs set by two different
     * mechanisms at two different moments, and until this call existed nothing compared them — so a
     * rotated api wallet with no front-end rebuild sent every tipper's SOL to an address the api
     * then refused with a terminal 402, on which settleTip clears the pending record and the only
     * proof of the transfer with it. This is the last instant at which refusing is free.
     */
    say('checking where the tip must go…');
    const dest = await checkTipDestination(TIP_WALLET);
    if (!dest.ok) {
      setArmed(null);
      // A mismatch is an operator error that is actively destroying money; everything else is a
      // "could not ask". Different tone, because they call for different actions from the reader.
      say(dest.why, dest.kind === 'mismatch' ? 'bad' : 'warn');
      return;
    }

    // A large tip is described in full — amount AND destination — and waits for a second press.
    if (amt.confirm && !(armed && armed.sol === sol && Date.now() - armed.at < CONFIRM_WINDOW_MS)) {
      setArmed({ sol, at: Date.now() });
      say(`⚠️ you are about to send ${sol} SOL to ${dest.wallet}. this is real, irreversible mainnet SOL. press Tip again within a minute to confirm, or change the amount to cancel.`, 'warn');
      return;
    }
    setArmed(null);

    let signature = '';
    try {
      say('building transaction…');
      // A DEADLINE ON THE BLOCKHASH READ. This is the money path and it runs in a browser, where
      // fetch has no default timeout: a public RPC that accepts the connection and never answers
      // would leave the page on "building transaction…" forever, with the user unsure whether
      // anything was sent. Nothing has been signed at this point, so an abort here is genuinely
      // "cancelled, nothing left your wallet" — the one moment that sentence is still true.
      // Wrap the global fetch so the RPC read has a deadline. The Fetch API is callable but does
      // not expose Node-only connection helpers such as `preconnect`; copying one made the static
      // browser build fail its typecheck without changing runtime behavior.
      const deadlineFetch = ((
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) =>
        fetch(input, {
          ...init,
          signal: apiDeadline(BLOCKHASH_TIMEOUT_MS),
        })) as typeof fetch;
      const conn = new Connection(RPC, { commitment: 'confirmed', fetch: deadlineFetch });
      const from = new PublicKey(wallet);
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
      const tx = new Transaction({ feePayer: from, blockhash, lastValidBlockHeight }).add(
        SystemProgram.transfer({
          fromPubkey: from,
          // `dest.wallet` — the address npc-api just said it credits — not the build-time constant.
          // They are equal here by construction; using the checked value means a future edit cannot
          // reintroduce the gap between "what we verified" and "what we send to".
          toPubkey: new PublicKey(dest.wallet),
          // Integer lamports: a fractional value is rejected by the runtime, and rounding here is
          // the difference between the amount shown and the amount actually sent.
          lamports: Math.round(sol * LAMPORTS_PER_SOL),
        }),
      );
      say('confirm it in your wallet…');
      const sent = await p.signAndSendTransaction(tx);
      signature = typeof sent?.signature === 'string' ? sent.signature : '';
    } catch {
      // Nothing was broadcast: "cancelled" is the truth, and it is the LAST moment it will be.
      say('tip failed / cancelled — nothing was sent.');
      return;
    }
    if (!signature) { say('tip failed / cancelled — nothing was sent.'); return; }

    // From here on the SOL is gone: never say "cancelled", and never claim credit we did not get.
    // The record is written BEFORE the first POST so a closed tab cannot lose the signature.
    const pending: PendingTip = { wallet, sol, sig: signature, message: tipNote.slice(0, 140), firstSeen: Date.now() };
    savePending(pending);
    await runSettle(pending);
  };

  /**
   * Resume a tip left unresolved (a closed tab, a reload, an expired session). Reconnecting opens
   * the wallet, which needs a real user gesture — so a page load must never do this by itself.
   */
  const resume = async () => {
    const p = loadPending();
    if (!p) { setShowRetry(false); say(''); return; }
    if (p.wallet !== wallet) {
      say(sigLine(`⏳ that tip belongs to ${shortAddr(p.wallet)} — connect that wallet to finish it. signature: `, p.sig), 'warn');
      return;
    }
    if (!loadSession(p.wallet)) {
      await connect();
      if (!loadSession(p.wallet)) {
        say(sigLine('⏳ this wallet is not signed in any more. signature: ', p.sig), 'warn');
        return;
      }
    }
    await runSettle(p);
  };

  /**
   * Give up on a pending tip. The signature is shown one last time first — it is the user's only
   * proof of the transfer, and clearing the record is the one action on this page that destroys it.
   */
  const forget = () => {
    const p = loadPending();
    clearPending();
    setShowRetry(false);
    if (p) say(sigLine('cleared. the transfer still happened — keep this signature if you want to chase it: ', p.sig), 'warn');
    else say('');
  };

  // A pending tip from an earlier visit is surfaced on load — but never auto-retried into a wallet
  // prompt, which would pop a signature request nobody asked for.
  useEffect(() => {
    const p = loadPending();
    if (p) {
      say(sigLine('⏳ you have a tip that was sent on-chain and is not credited yet. signature: ', p.sig), 'warn');
      setShowRetry(true);
    }
  }, []);

  const tierName = me?.tier?.name || '';

  return (
    <div className="npcg-root">
      <SeoHead
        title="Kamiko Holder Dashboard"
        description="Connect a wallet to view Kamiko holder tiers, perks, and tip status. Unavailable features are clearly marked when the live API is not configured."
        path="/holder/"
        noindex
      />
      {/* raw-text element — see agents.tsx: a text child is SSR entity-escaped (`>` → `&gt;`) and
          never un-escaped, breaking `.npcg-bar>span` pre-hydration and mismatching hydration. */}
      <style dangerouslySetInnerHTML={{ __html: NPC_CSS }} />

      <div className="npcg-wrap">
        <header className="npcg-head">
          <h1 className="npcg-logo">$<b>KAMIKO</b></h1>
          <span className="npcg-ca">holder dashboard</span>
        </header>

        {!API && (
          <div className="npcg-notice unsafe">
            this build has no funnel API configured (NEXT_PUBLIC_NPC_API), so tier, perks and tipping
            are all off. Nothing on this page can be trusted until it is set.
          </div>
        )}

        <div className="npcg-panel">
          <h3>Your wallet</h3>
          <div className="npcg-muted">
            connect to see your tier and perks, and to tip her — she reacts to tips on stream.
          </div>
          <button onClick={connect} disabled={connecting || !API} className="npcg-primary">
            {wallet ? '🔗 ' + shortAddr(wallet) : '🔗 Connect Phantom'}
          </button>
          <div className="npcg-note">{connectMsg}</div>
        </div>

        {wallet && (
          <div className="npcg-panel">
            <h3>Your tier</h3>
            <div className="npcg-tier">{tierName || 'ghost'}</div>
            {tierNote ? <div className="npcg-note warn">{tierNote}</div> : null}
            <div className="npcg-perks">
              {me?.tier
                ? (me.tier.perks || []).map((p) => <span key={p} className="npcg-perk">{p}</span>)
                : <span className="npcg-muted">public chat — a tier appears once $KAMIKO is live on-chain and your balance can be read.</span>}
            </div>
            <div className="npcg-grid">
              <Stat k="WAKES" v={(me?.taps || 0).toLocaleString()} />
              <Stat k="RANK" v={me?.rank ? '#' + me.rank : '—'} />
            </div>
          </div>
        )}

        {canSuggest && (
          <div className="npcg-panel">
            <h3>Name her next stream topic · sentient tier</h3>
            <div className="npcg-row">
              <input
                className="npcg-input"
                value={topic}
                maxLength={120}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') suggestTopic(); }}
                placeholder="what should she riff on next?"
              />
              <button onClick={suggestTopic} disabled={topicBusy} className="npcg-go">Send ✦</button>
            </div>
            <div className="npcg-note">{topicMsg}</div>
            <div className="npcg-k">
              {myTopics === null
                ? 'the topic queue is unavailable — the api did not answer.'
                : myTopics.length
                  ? 'YOUR RECENT TOPICS'
                  : 'you have not named one yet — she reads the next one out on stream.'}
            </div>
            {myTopics?.map((r, i) => (
              <div key={String(r.ts) + ':' + i} className="npcg-topic">
                <span>{r.topic}</span>
                <span>{Number.isFinite(Number(r.ts)) ? new Date(Number(r.ts)).toLocaleTimeString() : ''}</span>
              </div>
            ))}
          </div>
        )}

        {wallet && (
          <div className="npcg-panel">
            <h3>Tip the NPC (SOL)</h3>
            {!TIP_WALLET ? (
              <div className="npcg-muted">
                tipping is off on this deployment — no tip address is configured, so there is no
                destination npc-api would verify a transfer against.
              </div>
            ) : (
              <>
                <div className="npcg-row">
                  <input
                    className="npcg-input"
                    type="number"
                    step="0.01"
                    min={MIN_TIP_SOL}
                    max={MAX_TIP_SOL}
                    value={amount}
                    // Editing the amount CANCELS an armed confirmation. The confirmation named a
                    // specific number of SOL; letting it survive an edit would let a second press
                    // send an amount the user never had described to them.
                    onChange={(e) => { setArmed(null); setAmount(e.target.value); }}
                  />
                  <button onClick={tip} disabled={settling} className="npcg-go">
                    {armed ? 'Confirm ' + armed.sol + ' SOL ✦' : 'Tip ✦'}
                  </button>
                </div>
                <div className="npcg-muted">
                  {MIN_TIP_SOL}–{MAX_TIP_SOL} SOL. tips are real, irreversible mainnet transfers.
                </div>
                <input
                  className="npcg-input"
                  style={{ marginTop: 8 }}
                  value={tipNote}
                  maxLength={140}
                  onChange={(e) => setTipNote(e.target.value)}
                  placeholder="say something — she'll read it on stream (optional)"
                />
              </>
            )}
            <div className={'npcg-note' + (tipTone ? ' ' + tipTone : '')}>{tipMsg}</div>
            {showRetry && (
              <div className="npcg-row">
                <button onClick={resume} disabled={settling} className="npcg-btn" style={{ marginTop: 0, flex: 1 }}>
                  ↻ check that tip again
                </button>
                <button onClick={forget} disabled={settling} className="npcg-btn" style={{ marginTop: 0, flex: 1 }}>
                  ✕ forget it
                </button>
              </div>
            )}
          </div>
        )}

        <div className="npcg-panel">
          <h3>Top tippers · total {board ? board.total.toFixed(2) : '—'} SOL</h3>
          {board === null ? (
            <div className="npcg-muted">tips unavailable — the api did not answer.</div>
          ) : board.rows.length === 0 ? (
            <div className="npcg-muted">no tips yet — be the first.</div>
          ) : (
            board.rows.map((r, i) => (
              <div key={r.wallet} className="npcg-lb">
                <span>
                  <span className="npcg-rank">{i + 1}</span>
                  <span className={r.wallet === wallet ? 'neon' : ''}>{shortAddr(r.wallet)}</span>
                </span>
                <span>{r.total} SOL</span>
              </div>
            ))
          )}
        </div>

        <div className="npcg-links">
          <a href="/game">👆 The game</a>
          <a href="/">🎤 Talk to her</a>
          <a href="/trust">🛡️ Trust</a>
          <a href="/agents">🤖 Agents</a>
        </div>

        <p className="npcg-fine">
          Tips are voluntary and non-refundable. They buy no share, no claim and no promise — they are
          a tip to a character on a stream. $KAMIKO is an experimental memecoin for entertainment, with
          no intrinsic value, not an investment, and nothing here is financial advice. NVDAX is a
          tokenized tracker, NOT NVIDIA stock — holders own no NVIDIA shares. Not affiliated with
          NVIDIA, Backed, Raydium or StonkFun beyond being launched on StonkFun. There is no official
          $KAMIKO contract until the mint is live and pinned here.
        </p>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="npcg-card"><div className="npcg-k">{k}</div><div className="npcg-v">{v}</div></div>;
}
