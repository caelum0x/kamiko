/**
 * cf-worker/marketReaction.ts — Kamiko picks how to REACT to the live tape, with Jev.
 *
 * WHY THIS EXISTS. The stage already crosses a band (features/emote/marketEmote.ts): a ±5% move
 * throws a `stonks`/`rekt` pose and then — per that file's own comment — "she says nothing about it."
 * She reacts with her body and stays mute. This module gives that moment a VOICE: given the current
 * market signal it selects the single best in-character reaction from a CODE-SUPPLIED candidate set
 * and returns a spoken line + face. The `/api/reaction` endpoint in index.ts serves it and the stage
 * speaks it on the same crossing that used to be silent.
 *
 * HOW THE MODEL IS USED (fast + safe). Jev never writes a word. Every candidate LINE, every TONE and
 * the hype LEVELS are authored here in code; Jev only PICKS among them — three independent questions
 * batched into ONE /v1/systemone call that run in parallel on the server:
 *   - choice(tone)  → HOW she sounds (drives her face)
 *   - choice(line)  → WHICH pre-written line fits this exact move (she cannot invent one)
 *   - score(hype)   → how big the moment is (drives whether she throws a gesture)
 * Because the model can only return one of our keys, the output is bounded and cannot go off-persona,
 * violate the hard rules ("never give financial advice", "never promise price"), or hallucinate a
 * number — the same safety the candidate-picking pattern buys everywhere else in this repo.
 *
 * ENV-GATED, DEGRADES HONESTLY. The Jev call only runs when TYPESAFE_API_KEY (a Cloudflare Worker
 * secret) is set. With no key it falls back to the deterministic rule below — a band-appropriate line
 * chosen in code — so an unconfigured deploy still speaks a real, in-character reaction, never a stub
 * and never a fabricated result. Any Jev failure (timeout, non-200, unusable answer) degrades to that
 * same rule rather than throwing: the stage must never go dead on a market tick.
 */

// ── Bands (mirrored from src/features/emote/marketEmote.ts so both halves agree) ─────────────────
/** Percent move that counts as a pump. */
export const STONKS_PCT = 5;
/** Percent move that counts as a dump. */
export const REKT_PCT = -5;

export type Band = 'up' | 'flat' | 'down';

/** PURE. The band a percentage sits in. A missing/!finite number reads as `flat` (no opinion). */
export function bandForPct(pct: number | null | undefined): Band {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return 'flat';
  if (pct >= STONKS_PCT) return 'up';
  if (pct <= REKT_PCT) return 'down';
  return 'flat';
}

// ── The market signal the reaction is judged on ─────────────────────────────────────────────────
export interface MarketSignal {
  /** NVDAX price in USD. */
  readonly priceUsd: number;
  /** 24h percent change, or null when the tape did not give an honest number. */
  readonly change24h: number | null;
}

// ── Env (only the TypeSafe bits; the full Env lives in index.ts) ─────────────────────────────────
export interface ReactionEnv {
  /** Cloudflare Worker secret. Set → Jev picks the reaction; unset → deterministic rule. */
  TYPESAFE_API_KEY?: string;
  /** Override the TypeSafe base URL (default https://api.typesafe.ai/v1). */
  TYPESAFE_BASE_URL?: string;
  /** Override the model (default jev-latest). */
  TYPESAFE_MODEL?: string;
}

// ── Code-built candidates: TONES ────────────────────────────────────────────────────────────────
// A fixed set of ways she can sound. Each maps to a valid amica emotion tag (see EMOTIONS in
// index.ts) so the chosen tone actually moves her face while the line is spoken.
const TONE_EMOTION: Readonly<Record<string, string>> = {
  hyped: 'happy',
  smug: 'victory',
  deadpan: 'bored',
  cozy: 'relaxed',
  spiraling: 'sad',
};

const TONE_CRITERIA: Readonly<Record<string, string>> = {
  hyped: 'loud, euphoric, gremlin-energy celebration',
  smug: 'cocky victory-lap, told-you-so swagger (never a price promise)',
  deadpan: 'flat, existential, unbothered NPC narration',
  cozy: 'warm, chill, community-hug energy',
  spiraling: 'melodramatic despair, coping out loud — theatrical, never actually bleak',
};

// ── Code-built candidates: LINES per band ───────────────────────────────────────────────────────
// Every line is PG-13, in the $KAMIKO voice, narrates the tape, and breaks NO hard rule: none give
// advice, promise gains, or invent a statistic. Jev only picks the one that best fits the move.
const LINES: Readonly<Record<Band, readonly string[]>> = {
  up: [
    'the tape is GREEN and i am insufferable about it. we simply move.',
    "candles going up and so is my ego. i'm not saying anything, i'm just vibing loudly.",
    'green day. the number went up and i felt that in my little rendered soul.',
    "npc.exe is euphoric right now. do NOT ask me for advice, i'm just here for the bit.",
  ],
  down: [
    "the chart is bleeding and i'm taking it personally. dramatic sigh.",
    'red candles again. i woke up for THIS? crawling back into the gray background.',
    'we are down bad and i am coping in real time. not advice, just vibes, just pain.',
    "the tape said 'no' today. i respect the honesty. i hate the number.",
  ],
  flat: [
    "crab market. sideways forever. i'm just narrating the void at this point.",
    "nothing's happening and i'm contractually obligated to have a personality about it.",
    'flat tape. the market is asleep and honestly? relatable.',
    "we're chopping sideways. i'll be here, being an NPC, watching the line do nothing.",
  ],
};

// ── Code-built candidates: HYPE levels (lowest → highest) ────────────────────────────────────────
const HYPE_LEVELS: readonly string[] = [
  'dead: nobody cares, the tape is asleep',
  'mild: a flicker, barely worth reacting to',
  'notable: a real move worth acknowledging',
  'big: chat is watching, this is a moment',
  'peak: maximum chaos, she is (in character) losing it',
];

// ── The reaction this module produces ───────────────────────────────────────────────────────────
export interface Reaction {
  /** Spoken line with a single leading `[emotion]` tag — the exact shape the chat/tap path speaks. */
  readonly reply: string;
  /** The chosen line, no tag. */
  readonly line: string;
  /** The chosen tone key. */
  readonly tone: string;
  /** The amica emotion tag the tone maps to. */
  readonly emotion: string;
  /** Optional gesture to throw (only on a high-hype moment); null otherwise. */
  readonly emote: string | null;
  /** 0..4 hype level of the moment. */
  readonly hype: number;
  readonly band: Band;
  /** Whether Jev picked it or the deterministic fallback did. */
  readonly source: 'jev' | 'rule';
}

/** PURE. Compose the spoken reply + gesture from the three picked pieces. */
function compose(band: Band, tone: string, line: string, hype: number, source: 'jev' | 'rule'): Reaction {
  const emotion = TONE_EMOTION[tone] ?? 'neutral';
  // A gesture only on a genuinely big moment — otherwise the pose the crossing already threw stands
  // alone. band → gesture matches the emotes marketEmote.ts fires (stonks/rekt).
  const emote = hype >= 3 ? (band === 'up' ? 'stonks' : band === 'down' ? 'rekt' : 'hype') : null;
  return {
    reply: `[${emotion}] ${line}`,
    line,
    tone,
    emotion,
    emote,
    hype,
    band,
    source,
  };
}

// ── Deterministic fallback (no key, or Jev unavailable) ──────────────────────────────────────────
// The "fixed rule" the Jev decision replaces. Band → tone, and a line chosen by a stable hash of the
// price so a flat tape does not read the identical sentence every crossing, yet the same tape always
// yields the same line (pure, testable, no randomness on the request path).
const RULE_TONE: Readonly<Record<Band, string>> = { up: 'hyped', flat: 'deadpan', down: 'spiraling' };

/** PURE. */
export function ruleReaction(signal: MarketSignal): Reaction {
  const band = bandForPct(signal.change24h);
  const pool = LINES[band];
  // Stable index from the price magnitude; |change| widens the spread across the pool.
  const seed = Math.abs(Math.round(signal.priceUsd * 100)) + Math.abs(Math.round((signal.change24h ?? 0) * 10));
  const line = pool[seed % pool.length];
  const magnitude = Math.abs(signal.change24h ?? 0);
  const hype = band === 'flat' ? 1 : magnitude >= 12 ? 4 : magnitude >= 8 ? 3 : 2;
  return compose(band, RULE_TONE[band], line, hype, 'rule');
}

// ── Minimal TypeSafe / Jev client (self-contained; no cross-repo import, no deps) ────────────────
const DEFAULT_BASE_URL = 'https://api.typesafe.ai/v1';
const DEFAULT_MODEL = 'jev-latest';

interface ChoiceAnswer {
  type?: string;
  choice?: unknown;
  probabilities?: Record<string, number>;
  confidence?: number;
}
interface ScoreAnswer {
  type?: string;
  score?: unknown;
  confidence?: number;
}
interface SystemOneResponse {
  answers?: Record<string, ChoiceAnswer | ScoreAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Ask Jev to pick tone + line + hype in ONE batched call. Returns the parsed response, or null on
 * any failure (unset key, timeout, non-200, unparseable body) so the caller degrades to the rule.
 */
async function askJev(
  env: ReactionEnv,
  signal: MarketSignal,
  band: Band,
  lineKeys: Readonly<Record<string, string>>,
): Promise<SystemOneResponse | null> {
  const key = env.TYPESAFE_API_KEY?.trim();
  if (!key) return null;
  const baseUrl = (env.TYPESAFE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = env.TYPESAFE_MODEL?.trim() || DEFAULT_MODEL;

  const state = {
    persona:
      '$KAMIKO — a self-aware anime-girl VTuber who woke up inside NVIDIA and narrates (never trades) the market. Chaotic gamer-girl on the surface, deadpan-existential underneath.',
    market: {
      token: 'NVDAX (tokenized NVIDIA tracker she is paired against on Solana)',
      priceUsd: signal.priceUsd,
      change24hPct: signal.change24h,
      band,
    },
    note: 'She is reacting OUT LOUD to this exact move. Pick the tone, the single best pre-written line, and the hype level. Never pick anything that gives financial advice or promises a price.',
  };

  const body = JSON.stringify({
    state,
    model,
    questions: {
      tone: {
        type: 'choice',
        instructions: 'How should Kamiko sound reacting to this exact market move, in character?',
        criteria: TONE_CRITERIA,
      },
      line: {
        type: 'choice',
        instructions:
          'Pick the ONE pre-written candidate line that best fits this exact move and her persona. Do not invent a line; choose only from these.',
        criteria: lineKeys,
      },
      hype: {
        type: 'score',
        instructions: 'How big a moment is this move for the stream, right now?',
        criteria: HYPE_LEVELS,
      },
    },
  });

  const signalTimeout =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(8000)
      : undefined;

  try {
    const res = await fetch(`${baseUrl}/systemone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body,
      signal: signalTimeout,
    });
    if (!res.ok) return null;
    return (await res.json()) as SystemOneResponse;
  } catch {
    return null;
  }
}

/** PURE. Read a valid choice key from an answer, or null. */
function readChoice(ans: ChoiceAnswer | ScoreAnswer | undefined, valid: Readonly<Record<string, unknown>>): string | null {
  const choice = (ans as ChoiceAnswer | undefined)?.choice;
  return typeof choice === 'string' && Object.prototype.hasOwnProperty.call(valid, choice) ? choice : null;
}

/** PURE. Read a 0..(levels-1) integer score, or null. */
function readScore(ans: ChoiceAnswer | ScoreAnswer | undefined, levels: number): number | null {
  const raw = (ans as ScoreAnswer | undefined)?.score;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(levels - 1, Math.round(raw)));
}

/**
 * Choose Kamiko's reaction to the current market. Jev picks when TYPESAFE_API_KEY is set; otherwise
 * (or on any Jev failure) the deterministic rule picks. Always returns a real, in-character reaction.
 */
export async function chooseReaction(signal: MarketSignal, env: ReactionEnv): Promise<Reaction> {
  const band = bandForPct(signal.change24h);
  const pool = LINES[band];
  // Candidate lines as stable keys the model picks among; the text is the description it reads.
  const lineKeys: Record<string, string> = {};
  pool.forEach((text, i) => {
    lineKeys[`l${i}`] = text;
  });

  const resp = await askJev(env, signal, band, lineKeys);
  if (!resp?.answers) return ruleReaction(signal);

  const tone = readChoice(resp.answers.tone, TONE_CRITERIA);
  const lineKey = readChoice(resp.answers.line, lineKeys);
  const hype = readScore(resp.answers.hype, HYPE_LEVELS.length);

  // If Jev could not give a usable line or tone, fall back to the rule rather than a half-answer.
  if (!lineKey || !tone) return ruleReaction(signal);

  const line = lineKeys[lineKey];
  const rule = ruleReaction(signal);
  return compose(band, tone, line, hype ?? rule.hype, 'jev');
}
