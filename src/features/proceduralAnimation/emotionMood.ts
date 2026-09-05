/**
 * emotionMood.ts — PURE map from the face's current emotion to how the BODY idles.
 *
 * The statistical idle (airi's motion model, statisticalIdle.ts) used to run one fixed
 * temperament: [angry] and [sleep] swayed identically, so the emotion lived only from the neck
 * up. This maps each of the product's 14 emotion tags (services/bridge/emotion.ts is the sender)
 * onto two bounded modulations of the idle stream:
 *
 *   - `tempo`: time scaling of the generated motion (faster = agitated, slower = drowsy);
 *   - `sway`:  amplitude scaling of each channel's deviation from its base pose.
 *
 * Both are HARD-BOUNDED here, because they feed a humanoid rig every frame: the idle's own
 * per-channel clamp is the last line, and these bounds keep the modulation from ever leaning on
 * it. An emotion this file does not know idles neutral — a new tag can never break the body.
 */

export interface IdleMood {
  /** Time scale of the idle stream. Bounded to [MIN_TEMPO, MAX_TEMPO]. */
  tempo: number;
  /** Amplitude scale of deviations from the base pose. Bounded to [MIN_SWAY, MAX_SWAY]. */
  sway: number;
}

export const MIN_TEMPO = 0.5;
export const MAX_TEMPO = 1.6;
export const MIN_SWAY = 0.5;
export const MAX_SWAY = 1.4;

export const NEUTRAL_MOOD: Readonly<IdleMood> = Object.freeze({ tempo: 1, sway: 1 });

/** The 14 tags the bridge can send (lowercased), plus 'neutral'. Unknown ⇒ neutral. */
const MOODS: Readonly<Record<string, IdleMood>> = Object.freeze({
  neutral: { tempo: 1, sway: 1 },
  happy: { tempo: 1.15, sway: 1.15 },
  angry: { tempo: 1.35, sway: 1.25 },
  sad: { tempo: 0.75, sway: 0.7 },
  relaxed: { tempo: 0.85, sway: 0.9 },
  surprised: { tempo: 1.3, sway: 1.1 },
  shy: { tempo: 0.9, sway: 0.75 },
  jealous: { tempo: 1.1, sway: 1.05 },
  bored: { tempo: 0.7, sway: 0.8 },
  serious: { tempo: 0.85, sway: 0.8 },
  suspicious: { tempo: 0.9, sway: 0.85 },
  victory: { tempo: 1.35, sway: 1.3 },
  sleep: { tempo: 0.55, sway: 0.6 },
  love: { tempo: 1.05, sway: 1.1 },
});

const clamp = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? (v < lo ? lo : v > hi ? hi : v) : 1);

/**
 * PURE. The idle temperament for an emotion tag. Case-insensitive (the tag arrives as 'angry'
 * from the bridge but 'Surprised' from amica's own list); anything unrecognised is neutral.
 */
export function moodFor(emotion: string): IdleMood {
  const m = MOODS[String(emotion ?? '').trim().toLowerCase()] ?? NEUTRAL_MOOD;
  return { tempo: clamp(m.tempo, MIN_TEMPO, MAX_TEMPO), sway: clamp(m.sway, MIN_SWAY, MAX_SWAY) };
}
