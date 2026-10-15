/**
 * marketReactionClient — fetch Kamiko's spoken reaction to the live tape from same-origin
 * `/api/reaction` (the edge Worker in cf-worker/index.ts).
 *
 * WHY. marketEmote.ts fires a `stonks`/`rekt` pose when the tape crosses ±5% and then — per its own
 * comment — "she says nothing about it." This closes that gap: on the same crossing the stage asks
 * the Worker for a line and speaks it, so the move she just posed about finally has a VOICE. The
 * Worker picks that line with Jev when TYPESAFE_API_KEY is set, and with a deterministic in-code rule
 * when it is not, so this always resolves to a real, in-character line.
 *
 * Degrades SILENTLY, exactly like preflightChat: any non-200 (e.g. 503 market_unavailable on an
 * unconfigured deploy or a missing quote) or network error resolves to null and the stage simply
 * stays quiet — a market tick must never surface an error or a fabricated line. The origin is never
 * hardcoded: `/api/reaction` is relative (same-origin) on purpose.
 */

/** The fields the stage reads. Everything else the Worker returns (tone, hype, band…) is ignored. */
interface ReactionBody {
  reply?: unknown;
}

/** Only accept a non-empty trimmed string. */
function str(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

/**
 * Ask the Worker for Kamiko's reaction to the CURRENT market. Returns the spoken line (with its
 * leading `[emotion]` tag) or null when there is nothing to say. Never throws.
 */
export async function fetchMarketReaction(signal?: AbortSignal): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch("/api/reaction", { method: "GET", headers: { accept: "application/json" }, signal });
  } catch {
    return null; // network / abort — stay silent.
  }
  if (!res.ok) return null; // 503 market_unavailable, or any other non-200 — stay silent.
  let body: ReactionBody | null = null;
  try {
    body = (await res.json()) as ReactionBody;
  } catch {
    return null;
  }
  const reply = str(body?.reply);
  return reply || null;
}
