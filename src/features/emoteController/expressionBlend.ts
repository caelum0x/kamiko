/**
 * expressionBlend.ts — PURE easing for facial expression weights.
 *
 * The face used to SNAP: `playEmotion` wrote the new expression's full weight in one frame and
 * zeroed the old one in the same instant, so every emotion change was a single-frame jump cut —
 * the second-biggest "it's a puppet" tell after the volume mouth. Real faces attack fast and
 * release slower; this module is that curve, kept pure so it is testable to the frame.
 *
 * Exponential approach (frame-rate independent): after `tau` seconds the value has closed ~63%
 * of the remaining gap, whatever the frame timing did. Rising uses a shorter tau than falling on
 * purpose — an emotion should land quickly and let go gently.
 */

/** Seconds to close ~63% of the gap when the weight is RISING (attack). */
export const TAU_RISE_S = 0.09;
/** Seconds to close ~63% of the gap when the weight is FALLING (release). */
export const TAU_FALL_S = 0.25;
/** Below this a weight is snapped to its target — the render must eventually settle exactly. */
export const SETTLE_EPSILON = 0.001;

/**
 * PURE. One easing step: where `current` moves toward `target` after `dt` seconds.
 *
 * Never overshoots, never goes negative, and treats a non-finite dt (first frame, tab resume) as
 * no time passed — this feeds a VRMExpressionManager every frame, where NaN is a broken face.
 */
export function approach(
  current: number,
  target: number,
  dt: number,
  tauRise: number = TAU_RISE_S,
  tauFall: number = TAU_FALL_S,
): number {
  if (!Number.isFinite(current)) return target;
  if (!Number.isFinite(dt) || dt <= 0) return current;
  const tau = target > current ? tauRise : tauFall;
  const next = tau > 0 ? current + (target - current) * (1 - Math.exp(-dt / tau)) : target;
  return Math.abs(next - target) < SETTLE_EPSILON ? target : next;
}

/** One expression's easing state. */
export interface BlendState {
  target: number;
  current: number;
}

/**
 * PURE. Step every tracked expression one frame toward its target and drop the ones that have
 * fully released — returns a NEW map (never mutates), plus the weights to write this frame.
 * Dropping settled zeros is what keeps the map from growing one entry per emotion ever played.
 */
export function stepBlends(
  blends: ReadonlyMap<string, BlendState>,
  dt: number,
): { next: Map<string, BlendState>; weights: Array<[string, number]> } {
  const next = new Map<string, BlendState>();
  const weights: Array<[string, number]> = [];
  for (const [name, b] of blends) {
    const current = approach(b.current, b.target, dt);
    weights.push([name, current]);
    if (!(b.target === 0 && current === 0)) next.set(name, { target: b.target, current });
  }
  return { next, weights };
}
