/**
 * marketEmote.ts — PURE. The live tape decides when she throws the stonks pose.
 *
 * WHY THIS EXISTS. The market loop was already real end-to-end: the bridge reads NVDAX off
 * DexScreener and $KAMIKO off Raydium LaunchLab, `GET /market` serves it, and `MarketHud` prints
 * it in the corner. What it never did was reach HER. A -15% candle changed two numbers in a chip
 * at the top of the screen and the avatar under it kept smiling — the whole premise of a character
 * who "woke up inside a market" undone by the one surface the audience is actually looking at.
 *
 * The rule is deliberately a CROSSING, not a level. A level ("she is over +5%, be excited") fires
 * every 60-second poll for as long as the move lasts, which is a character stuck in a loop; a
 * crossing fires once, when the tape moves through the threshold, which is a character reacting.
 * Coming back inside the band re-arms it, so a chart that chops around ±5% cannot spam either.
 *
 * It never invents a reaction from a missing number: null in, null out. That matters more here
 * than it looks — `change24h` arrives over the network and is optional at every hop, and a JSON
 * `null` coerced to 0 would read as "flat" and permanently re-arm the trigger.
 */
import type { EmoteId } from './emotes';

/** The bits of `GET /market` this decision reads. Everything optional; nothing trusted. */
export interface MarketLike {
  quote?: { change24h?: number | null } | null;
  tokenTape?: { change24h?: number | null; live?: boolean } | null;
}

/** Percent move that counts as a pump. */
export const STONKS_PCT = 5;
/** Percent move that counts as a dump. */
export const REKT_PCT = -5;

/**
 * PURE. The percentage the reaction is judged on, or null when there is no honest number.
 *
 * HER OWN TOKEN WINS when it is live: $KAMIKO's move is the one she has a stake in. Before launch
 * there is no curve and no price, so the NVDAX quote she is paired against is the tape — which is
 * also the only one there is for the first hours of a launch.
 */
export function pulsePct(m: MarketLike | null | undefined): number | null {
  const token = m?.tokenTape;
  if (token?.live && typeof token.change24h === 'number' && Number.isFinite(token.change24h)) {
    return token.change24h;
  }
  const q = m?.quote?.change24h;
  return typeof q === 'number' && Number.isFinite(q) ? q : null;
}

/** Which band a percentage sits in. `null` = we have no number and therefore no opinion. */
export type PulseBand = 'up' | 'flat' | 'down';

/** PURE. The band a percentage falls in, or null when there is nothing to band. */
export function bandFor(pct: number | null | undefined): PulseBand | null {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  if (pct >= STONKS_PCT) return 'up';
  if (pct <= REKT_PCT) return 'down';
  return 'flat';
}

/**
 * PURE. The emote to fire on this reading, given the band the last reading was in.
 *
 * `prev === null` is the FIRST reading of the session and deliberately fires nothing: a visitor who
 * opens the page during a week-long -30% drawdown should not be met by a stranger already mid-
 * breakdown. The band is still returned so the next poll can cross out of it.
 */
export function marketEmoteFor(
  prev: PulseBand | null,
  m: MarketLike | null | undefined,
): { emote: EmoteId | null; band: PulseBand | null } {
  const band = bandFor(pulsePct(m));
  if (band === null) return { emote: null, band: prev };
  if (prev === null || band === prev) return { emote: null, band };
  if (band === 'up') return { emote: 'stonks', band };
  if (band === 'down') return { emote: 'rekt', band };
  return { emote: null, band }; // back inside the band: re-armed, but she says nothing about it
}
