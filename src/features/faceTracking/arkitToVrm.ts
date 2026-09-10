/**
 * arkitToVrm.ts — the operator's face, in the avatar's vocabulary. PURE.
 *
 * MediaPipe's FaceLandmarker emits ARKit's 52 blendshape names ("eyeBlinkLeft", "jawOpen",
 * "browInnerUp", …). A VRM speaks a different, much smaller language: a handful of named
 * expressions (blink, blinkLeft, blinkRight, aa/ih/ou/ee/oh, lookUp/Down/Left/Right, happy, angry,
 * sad, relaxed) plus a humanoid head bone. This module is the translation, and nothing else — no
 * camera, no VRM, no three.js — so the mapping can be read and reasoned about on its own.
 *
 * WHAT IT DELIBERATELY DOES NOT TRANSLATE: the emotion presets. ARKit has enough signal to guess
 * at "happy" from a smile, and doing so would be wrong here. `happy`/`angry`/`sad` on this avatar
 * are SEMANTIC — the bridge injects an `[emotion]` tag with the line she is about to say, and the
 * expression is her reaction to what she is saying. Driving them from the operator's face would
 * mean she smiles because the person behind the camera smiled, mid-sentence, at something else.
 * The operator gets the face's MECHANICS (eyes, brows, jaw, head); the character keeps her moods.
 *
 * ALL WEIGHTS ARE CLAMPED TO 0..1 AND A NON-NUMBER BECOMES 0. This is a per-frame feed off a
 * camera through a WASM model: a dropped frame, a lost face or a partial result must produce a
 * neutral face, never NaN into a mesh — which does not throw, it silently corrupts the whole
 * skinned mesh until reload.
 */

/** One ARKit blendshape as MediaPipe reports it. */
export interface ArkitScore {
  categoryName?: string;
  score?: number;
}

/** What the driver applies to the VRM each frame. */
export interface VrmFacePose {
  /** VRM expression name → weight, already clamped. */
  expressions: Record<string, number>;
  /** Head rotation in radians. Applied to the humanoid head bone. */
  head: { pitch: number; yaw: number; roll: number };
  /** False when the tracker had no face this frame — the caller should ease back to neutral. */
  tracked: boolean;
}

/** PURE. 0..1, with anything unusable becoming 0. */
export function clamp01(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** PURE. Blendshape scores as a name→weight map, lowercased so lookups cannot miss on case. */
export function scoreMap(scores: readonly ArkitScore[] | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  if (!Array.isArray(scores)) return m;
  for (const s of scores) {
    const name = typeof s?.categoryName === 'string' ? s.categoryName.toLowerCase() : '';
    if (name) m.set(name, clamp01(s?.score));
  }
  return m;
}

/**
 * The mouth, from the jaw and the lips.
 *
 * VRM's five mouth expressions are VOWELS, not muscles, so this is an interpretation rather than a
 * lookup: `jawOpen` with neutral lips is "aa", `mouthFunnel`/`mouthPucker` round it toward "ou",
 * and a wide `mouthSmile` with a closed jaw is "ih". It will never be as good as a phoneme
 * recogniser — which is exactly why the driver hands the mouth back to the lip-sync the moment she
 * is speaking, and only uses this while she is silent.
 */
export function mouthFrom(s: Map<string, number>): Record<string, number> {
  const g = (k: string) => s.get(k) ?? 0;
  const jaw = g('jawopen');
  const funnel = Math.max(g('mouthfunnel'), g('mouthpucker'));
  const wide = Math.max(g('mouthsmileleft'), g('mouthsmileright'));
  // A funnelled jaw is "ou"/"oh"; an open jaw with spread lips is "aa"; a closed wide mouth is
  // "ih". The three are scaled by how open the jaw is so a still face produces a closed mouth.
  return {
    aa: clamp01(jaw * (1 - funnel)),
    ou: clamp01(jaw * funnel),
    oh: clamp01(jaw * funnel * 0.6),
    ih: clamp01(wide * (1 - jaw) * 0.8),
    ee: clamp01(wide * jaw * 0.5),
  };
}

/**
 * The eyes.
 *
 * VRM models vary: some carry `blinkLeft`/`blinkRight`, some only a joint `blink`. Both are
 * emitted and the caller applies whichever the model actually has — asking a VRM for an expression
 * it does not define is a no-op, so emitting both costs nothing and covers both rigs.
 *
 * The gaze is squint-free on purpose: ARKit's `eyeLookIn/Out` are per-eye and converge, and
 * feeding convergence into a VRM's shared lookUp/Down/Left/Right produces a cross-eyed avatar. The
 * two eyes are averaged into one direction, which is what the rig can actually express.
 */
export function eyesFrom(s: Map<string, number>): Record<string, number> {
  const g = (k: string) => s.get(k) ?? 0;
  const blinkL = g('eyeblinkleft');
  const blinkR = g('eyeblinkright');
  const up = (g('eyelookupleft') + g('eyelookupright')) / 2;
  const down = (g('eyelookdownleft') + g('eyelookdownright')) / 2;
  // "In" and "out" are mirrored per eye: the LEFT eye looking out and the RIGHT eye looking in are
  // the same head-relative direction. Averaging them the naive way cancels the signal to zero.
  const left = (g('eyelookoutleft') + g('eyelookinright')) / 2;
  const right = (g('eyelookinleft') + g('eyelookoutright')) / 2;
  return {
    blinkLeft: blinkL,
    blinkRight: blinkR,
    blink: clamp01((blinkL + blinkR) / 2),
    lookUp: up,
    lookDown: down,
    lookLeft: left,
    lookRight: right,
  };
}

/** The brows. VRM has no brow expressions in the standard preset set; most models define these. */
export function browsFrom(s: Map<string, number>): Record<string, number> {
  const g = (k: string) => s.get(k) ?? 0;
  return {
    browInnerUp: g('browinnerup'),
    browOuterUp: clamp01((g('browouterupleft') + g('browouterupright')) / 2),
    browDown: clamp01((g('browdownleft') + g('browdownright')) / 2),
  };
}

/**
 * PURE. The head rotation, from MediaPipe's 4x4 facial transformation matrix (column-major).
 *
 * Only the rotation is taken — translation would move her head off her neck, and the scale is the
 * model's guess at how far away the operator is sitting, which is not something the avatar should
 * inherit. Extracted with the standard XYZ decomposition; a matrix that is not 16 finite numbers
 * yields zeros rather than NaN, because these values are written straight onto a bone.
 *
 * The result is CLAMPED to a comfortable human range. Beyond it the neck visibly detaches on most
 * VRMs, and an operator turning to look at a second monitor should not snap the avatar's head
 * ninety degrees on stream.
 */
export const MAX_HEAD_PITCH = 0.6;
export const MAX_HEAD_YAW = 0.7;
export const MAX_HEAD_ROLL = 0.45;

export function headFrom(matrix: readonly number[] | null | undefined): { pitch: number; yaw: number; roll: number } {
  const zero = { pitch: 0, yaw: 0, roll: 0 };
  if (!Array.isArray(matrix) || matrix.length < 16) return zero;
  for (let i = 0; i < 16; i++) if (!Number.isFinite(matrix[i])) return zero;

  // Column-major: m[col * 4 + row].
  const m00 = matrix[0]!, m10 = matrix[1]!, m20 = matrix[2]!;
  const m21 = matrix[6]!, m22 = matrix[10]!;

  const clamp = (v: number, max: number) => (v < -max ? -max : v > max ? max : v);
  const sy = Math.hypot(m00, m10);
  // A degenerate (gimbal-locked) matrix has no roll to recover; taking it anyway produces a
  // violent spin on the frame the operator tips their head fully back.
  if (sy < 1e-6) return zero;

  return {
    // Negated: MediaPipe reports the camera-space transform of the face, and the avatar should
    // MIRROR the operator — she turns her head the way they turned theirs, not the opposite way,
    // which is what a viewer expects from a puppet and what an operator expects from a mirror.
    pitch: clamp(-Math.atan2(m21, m22), MAX_HEAD_PITCH),
    yaw: clamp(-Math.atan2(-m20, sy), MAX_HEAD_YAW),
    roll: clamp(Math.atan2(m10, m00), MAX_HEAD_ROLL),
  };
}

/** PURE. One tracker result → everything the VRM needs for this frame. */
export function toVrmFacePose(
  blendshapes: readonly ArkitScore[] | null | undefined,
  matrix: readonly number[] | null | undefined,
): VrmFacePose {
  const s = scoreMap(blendshapes);
  if (s.size === 0) return { expressions: {}, head: { pitch: 0, yaw: 0, roll: 0 }, tracked: false };
  return {
    expressions: { ...mouthFrom(s), ...eyesFrom(s), ...browsFrom(s) },
    head: headFrom(matrix),
    tracked: true,
  };
}

/**
 * PURE. Ease `from` toward `to` by a time constant, frame-rate independently.
 *
 * The camera runs at 30fps and the renderer at 60–144; applying raw tracker values makes the face
 * step visibly on every other frame. `tau` is the time to cover ~63% of the remaining distance, so
 * the smoothing feels identical whatever the display is doing.
 */
export function approach(from: number, to: number, dt: number, tau = 0.06): number {
  if (!Number.isFinite(from)) return to;
  if (!(tau > 0) || !Number.isFinite(dt) || dt <= 0) return to;
  return from + (to - from) * (1 - Math.exp(-dt / tau));
}
