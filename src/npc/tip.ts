/**
 * tip.ts — the money path, and the only part of this front end where being wrong costs the user SOL.
 *
 * The flow has three stages and they FAIL DIFFERENTLY, which is why this is its own module rather
 * than a click handler:
 *
 *   1. Before a signature exists, nothing has left the wallet and "cancelled" is the truth.
 *   2. After the signature exists, real mainnet SOL has been broadcast. From that moment the only
 *      honest thing the page can say is what npc-api actually answered. Printing "✅ tipped N SOL"
 *      on a fire-and-forget POST is a lie in every one of the refusals npc-api actually returns —
 *      409 (duplicate), 402 (wrong destination or amount), 503 (verification unavailable) — where
 *      the user has signed, broadcast, been told it was credited, and was not credited.
 *   3. The opposite error is just as real: npc-api cannot confirm a transfer the RPC has not indexed
 *      yet, which is the ORDINARY case a second after the wallet returns. That refusal is not a
 *      verdict, so we keep the signature, keep asking, and survive a reload while we do.
 *
 * The signature is written to localStorage BEFORE the first POST, so a closed tab, a dead network or
 * a briefly-down api cannot lose the one piece of proof the user has.
 */
import { API, MAX_TIP_SOL, MIN_TIP_SOL, TIP_CONFIRM_SOL, apiDeadline } from './config.ts';
import { sessionHeaders } from './identity.ts';

/* ------------------------------------------------------------------ *
 * PURE: is this an amount we are willing to build a transaction for?
 * ------------------------------------------------------------------ */

export type AmountCheck =
  | { ok: true; sol: number; /** Large enough to deserve a second, deliberate press. */ confirm: boolean }
  | { ok: false; why: string };

/**
 * PURE. The bounds check that runs BEFORE the wallet is opened.
 *
 * The holder page used to validate exactly one thing — `sol > 0` — and left the rest to the
 * `min="0.01" step="0.01"` markup on a React controlled `<input type="number">`, which nothing in
 * the submit path ever consults (no form submit, no `checkValidity()`). So a typed or pasted value
 * went through unbounded: `10` and a fat-fingered `100` were equally acceptable to a page whose own
 * rule is that once the signature exists the SOL is gone and irreversible.
 *
 * Three outcomes, and the middle one is the point:
 *   - not a number / below MIN_TIP_SOL / above MAX_TIP_SOL ⇒ refused outright, nothing is built;
 *   - at or above TIP_CONFIRM_SOL ⇒ accepted but `confirm: true`, and the caller must state the
 *     amount and the destination and wait for a second press;
 *   - otherwise ⇒ straight through.
 *
 * `Number(...)` rather than `parseFloat(...)`, and `Number.isFinite` rather than a bare `> 0`:
 *   - parseFloat SILENTLY TRUNCATES trailing junk, so '1e', '100abc' and '0.5 SOL' each become a
 *     number that is not what was typed. On a field that names an irreversible transfer, an amount
 *     we had to guess at is not an amount we should send.
 *   - every comparison against NaN is false, so `if (sol > max)` alone would wave an unparseable
 *     amount straight PAST the ceiling — the one direction a cap must never fail in.
 */
export function checkTipAmount(
  raw: string,
  bounds: { min?: number; max?: number; confirmAt?: number } = {},
): AmountCheck {
  const min = bounds.min ?? MIN_TIP_SOL;
  const max = bounds.max ?? MAX_TIP_SOL;
  const confirmAt = bounds.confirmAt ?? TIP_CONFIRM_SOL;
  const sol = Number(String(raw ?? '').trim());
  if (!Number.isFinite(sol) || sol <= 0) return { ok: false, why: 'enter an amount above zero.' };
  if (sol < min) return { ok: false, why: `the smallest tip is ${min} SOL — a smaller one costs more in fees than it sends.` };
  if (sol > max) {
    return {
      ok: false,
      why: `${sol} SOL is over this page's ${max} SOL limit, so nothing was built and nothing left your wallet. lower the amount, or tip more than once if you really mean it.`,
    };
  }
  return { ok: true, sol, confirm: sol >= confirmAt };
}

/* ------------------------------------------------------------------ *
 * PURE: what npc-api's answer means
 * ------------------------------------------------------------------ */
export interface TipOutcome {
  credited: boolean;
  /** npc-api read the transfer back off the chain. Anything else is not a verified tip. */
  verified: boolean;
  retryable: boolean;
  retryAfterSec: number;
  reason: string;
}

/**
 * PURE. Mirrors @kamiko/web-kit `tipOutcome`, which services/game-api's refusal table is written
 * against. A money surface that only fails inside a browser is a money surface nothing can check.
 */
export function tipOutcome(res: { ok?: boolean; status?: number } | null, body: unknown): TipOutcome {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const stated = b && typeof b.error === 'string' && b.error ? b.error : '';
  const status = res && typeof res.status === 'number' ? res.status : 0;
  const rawAfter = b && typeof b.retryAfterSec === 'number' ? b.retryAfterSec : NaN;
  const after = Number.isFinite(rawAfter) && rawAfter > 0 ? Math.min(60, Math.max(1, Math.round(rawAfter))) : 5;

  // 409 + alreadyCredited: npc-api matched the signature to a row it holds for THIS session's
  // wallet. The tip landed — a retry that arrives after a lost response must not be reported as a
  // failure. (alreadyCredited:false — somebody else's row — stays a refusal.)
  if (status === 409 && b && b.alreadyCredited === true) {
    return { credited: true, verified: true, retryable: false, retryAfterSec: 0, reason: '' };
  }
  if (!res || res.ok !== true || !b || b.ok !== true) {
    // Retry only when the api SAID so, or when we could not read an answer to trust (no response at
    // all, a 5xx, a throttle). A 402/403/409 is a decision, and spinning on it is noise.
    const retryable = !res || status >= 500 || status === 408 || status === 429 ? true : b ? b.retryable === true : true;
    return {
      credited: false,
      verified: false,
      retryable,
      retryAfterSec: retryable ? after : 0,
      reason: stated || (res ? 'the api answered HTTP ' + status : 'the api did not answer'),
    };
  }
  return { credited: true, verified: b.verified === true, retryable: false, retryAfterSec: 0, reason: '' };
}

/* ------------------------------------------------------------------ *
 * The pending record — written before the first POST, survives a reload
 * ------------------------------------------------------------------ */

/** A tip that has been BROADCAST but not yet confirmed credited. */
export interface PendingTip {
  wallet: string;
  sol: number;
  sig: string;
  message: string;
  firstSeen: number;
}

const PENDING_KEY = 'npc_pending_tip';

/** How long we keep asking before handing the signature back to the user to chase. */
export const MAX_TIP_WAIT_MS = 10 * 60 * 1000;

export function loadPending(): PendingTip | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    return p && typeof p.sig === 'string' && typeof p.wallet === 'string' && p.sig && p.wallet ? (p as PendingTip) : null;
  } catch {
    return null;
  }
}

export function savePending(p: PendingTip): void {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); }
  catch { /* private mode: this tab still retries, it just cannot survive a reload */ }
}

export function clearPending(): void {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* nothing to do */ }
}

/* ------------------------------------------------------------------ *
 * The settle loop
 * ------------------------------------------------------------------ */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ONE attempt at getting the tip credited. Returns the pure outcome plus the HTTP status. */
async function postTip(p: PendingTip): Promise<{ outcome: TipOutcome; status: number }> {
  try {
    const res = await fetch(API + '/tip', {
      method: 'POST',
      // The session token identifies the tipper; without it npc-api answers 403.
      headers: { 'content-type': 'application/json', ...sessionHeaders(p.wallet) },
      // A hung attempt must not park the settle loop: an aborted attempt is a RETRYABLE outcome
      // (the catch below produces one), and retrying is exactly right — the transfer is already
      // on-chain and the only question is whether the api has read it yet.
      signal: apiDeadline(),
      body: JSON.stringify({ wallet: p.wallet, sol: p.sol, sig: p.sig, message: p.message }),
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    return { outcome: tipOutcome(res, body), status: res.status };
  } catch {
    return { outcome: tipOutcome(null, null), status: 0 };
  }
}

export type SettleResult =
  | { kind: 'credited'; verified: boolean }
  /** The chain has seen it and it is not a tip to us. Retrying cannot change this. */
  | { kind: 'not-credited'; why: string }
  /** Still unresolved — nothing is lost, the signature stays saved and the loop can resume. */
  | { kind: 'keep-checking'; why: string };

/**
 * Keep asking until npc-api gives a real answer. Only three things end this loop: credited, a
 * TERMINAL refusal, or running out of patience — and that last one leaves the signature saved.
 */
export async function settleTip(
  p: PendingTip,
  onAttempt: (attempt: number) => void,
  now: () => number = Date.now,
): Promise<SettleResult> {
  for (let attempt = 1; ; attempt++) {
    onAttempt(attempt);
    const { outcome, status } = await postTip(p);
    if (outcome.credited) {
      clearPending();
      return { kind: 'credited', verified: outcome.verified };
    }
    // A session that expired mid-flight is recoverable by reconnecting — it is NOT a verdict on the
    // transfer, so the pending record stays.
    if (status === 403) return { kind: 'keep-checking', why: 'this wallet is not signed in any more' };
    if (!outcome.retryable) {
      clearPending();
      return { kind: 'not-credited', why: outcome.reason };
    }
    if (now() - p.firstSeen > MAX_TIP_WAIT_MS) return { kind: 'keep-checking', why: outcome.reason };
    await sleep(Math.min(15000, (outcome.retryAfterSec || 3) * 1000 * Math.min(4, attempt)));
  }
}

/**
 * PURE. Why a topic submission was refused, in words that say what the holder can do about it.
 *
 * npc-api distinguishes "your tier is too low" from "we could not read your tier", and those are
 * very different sentences: the first is permanent until they buy more, the second is our outage
 * and it is worth retrying.
 */
export function topicRefusal(status: number, body: unknown): string {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const err = b && typeof b.error === 'string' ? b.error : '';
  if (status === 403 && b?.tierStatus === 'error') {
    return 'your $KAMIKO balance could not be read on-chain just now, so the perk is denied (it fails closed, never open). try again in a minute.';
  }
  if (status === 403 && b?.tierStatus === 'disabled') {
    return '$KAMIKO has not launched yet — there is no on-chain tier to check, so this perk is not live.';
  }
  if (status === 403 && b?.tier) {
    return 'this perk needs sentient tier — you are ' + String(b.tier) + '. hold more $KAMIKO and reconnect.';
  }
  if (status === 403) return 'connect again first — this session is no longer signed in.';
  if (status === 400) return 'type an actual topic — letters and numbers, one line.';
  if (status === 413) return 'that is too long. 120 characters, it becomes one line she reads out.';
  if (status === 429) {
    const after = b && typeof b.retryAfterSec === 'number' ? ` (${b.retryAfterSec}s)` : '';
    return 'slow down a moment' + after + ' — then send it again.';
  }
  return err || `the api answered ${status} — nothing was queued.`;
}
