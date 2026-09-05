/**
 * visemes.ts — PURE mapping from airi's vowel weights to VRM mouth expressions.
 *
 * The stage's mouth used to be one number: `LipSync.update()` reduced the whole waveform to a
 * volume and the face opened 'aa' by that much — every word the same flap, which is the single
 * biggest "it's a puppet" tell on a talking avatar. airi's lipsync package (merged in
 * src/airi/lipsync) carries the real fix: wLipSync classifies the audio into A/E/I/O/U/S viseme
 * weights (MFCC, in a worklet) and a shared vowel driver turns those into stable, smoothed vowel
 * weights. What was missing was the last inch — VRM expression names — and that is this file.
 *
 * Kept pure (no three-vrm, no audio) so the whole contract is testable: the driver's five vowels
 * map onto the five VRM mouth presets, damped when an emotion holds the face, and NEVER above the
 * expression manager's [0,1] range whatever the driver emits.
 */
import type { WLipSyncVowelWeights } from '@/airi/lipsync/shared/wlipsync'

/** airi vowel → VRM expression preset name (the VRM 1.0 mouth set amica's models ship). */
export const VOWEL_TO_VRM = Object.freeze({ A: 'aa', E: 'ee', I: 'ih', O: 'oh', U: 'ou' } as const)

export type VrmMouthExpression = (typeof VOWEL_TO_VRM)[keyof typeof VOWEL_TO_VRM]

export const VRM_MOUTH_EXPRESSIONS: readonly VrmMouthExpression[] = Object.freeze(['aa', 'ee', 'ih', 'oh', 'ou'])

/**
 * How hard the mouth may move while an emotion expression holds the face.
 *
 * Same rule the volume path has always applied (expressionController.update: neutral ⇒ ×0.5,
 * emotive ⇒ ×0.25 — i.e. an emotion halves the mouth), restated for visemes at full scale
 * because the vowel driver already caps its output at 0.7.
 */
export function mouthDamp(currentEmotion: string): number {
  return currentEmotion === 'neutral' ? 1 : 0.5
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0)

/**
 * PURE. One frame of vowel weights → the VRM expression weights to set this frame.
 *
 * Every value is clamped to [0,1] AFTER damping: the driver is trusted for shape, never for
 * range — an out-of-range weight on an expression manager distorts the mesh on stream.
 */
export function vowelsToVrmWeights(vowels: WLipSyncVowelWeights, damp = 1): Record<VrmMouthExpression, number> {
  const d = clamp01(damp)
  return {
    aa: clamp01(vowels.A * d),
    ee: clamp01(vowels.E * d),
    ih: clamp01(vowels.I * d),
    oh: clamp01(vowels.O * d),
    ou: clamp01(vowels.U * d),
  }
}
