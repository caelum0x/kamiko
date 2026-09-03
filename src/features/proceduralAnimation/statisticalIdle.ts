/**
 * statisticalIdle.ts — the VRM stage's idle motion, driven by the merged airi motion model.
 *
 * apps/vtuber-amica's procedural idle was a pure sine loop: every channel a single tone, so the
 * avatar repeated the exact same second of motion forever. On a VTuber that is on camera for hours
 * that reads as a looping GIF, which is the one thing a live character must not look like.
 *
 * airi's motion-driver-magic (merged verbatim into src/airi/motion) is a statistical motion model —
 * a ridge-regularized VAR fit that generates a fixed-rate stream of frames which never exactly
 * repeats. It was merged and then left with no caller; this is the caller. AIRI-MERGE.md listed
 * "render-loop hookup pending" as the one open item of that merge, and this closes it.
 *
 * How the model gets something to learn from: the deterministic idle IS the corpus. We sample the
 * hand-authored pose function below at a fixed rate for a few seconds and fit the VAR model to it,
 * with two incommensurate harmonics per channel so there is real coupled structure to learn rather
 * than one tone the model can only reproduce. What comes back is motion in the same family as the
 * authored idle — the same breathing, the same weight shift — that never lands on the same frame
 * twice.
 *
 * Two safety rules, both because this output drives a humanoid rig every frame:
 *
 *   - EVERY CHANNEL IS CLAMPED to a bounded envelope around its base pose. A statistical generator
 *     is free to excurse, and an unbounded excursion on a shoulder or a knee is not "expressive",
 *     it is a broken avatar on stream with no way to recover short of a reload.
 *   - A FIT FAILURE FALLS BACK, IT DOES NOT THROW. createVarModel throws on a corpus it cannot fit
 *     (too short, singular). This runs inside a requestAnimationFrame loop, where a throw kills the
 *     render loop and blanks the stage. A failed fit means the deterministic idle, which is exactly
 *     what shipped before.
 */
import type { VRMHumanBoneName } from '@pixiv/three-vrm'
import { VRM } from '@pixiv/three-vrm'

import { createVarModel } from '@/airi/motion'
import type { Generator, TrainingSequence } from '@/airi/motion'

/** Generation cadence. The model emits frames at this rate; the render loop interpolates between. */
const SAMPLE_RATE_HZ = 30

/** Seconds of authored idle sampled into the training corpus. */
const CORPUS_SECONDS = 8

/** VAR history depth. 3 lags at 30Hz is 100ms of context — enough to carry a breath, not a pose. */
const VAR_ORDER = 3

/** Ridge penalty. Small: the corpus is smooth and noise-free, so heavy regularization flattens it. */
const VAR_RIDGE = 1e-3

/**
 * One driven degree of freedom.
 *
 * `base` is the resting value the authored idle holds; `a1`/`w1` and `a2`/`w2` are the two
 * incommensurate harmonics it oscillates with (w2 is deliberately not a multiple of w1, so the pair
 * does not close into a short loop); `limit` is the hard envelope the generated value is clamped to
 * either side of `base`.
 */
interface Channel {
  bone: VRMHumanBoneName
  axis: 'x' | 'y' | 'z'
  base: number
  a1: number
  w1: number
  a2: number
  w2: number
  limit: number
}

const PI = Math.PI

/**
 * The idle pose, channel by channel. The `base` and first-harmonic terms are the values the previous
 * deterministic idle used, so the character's resting silhouette is unchanged; the second harmonic
 * and the envelope are what this file adds.
 */
const CHANNELS: readonly Channel[] = Object.freeze([
  { bone: 'spine' as VRMHumanBoneName, axis: 'x', base: -0.2, a1: -0.04 * PI, w1: 1.0, a2: -0.012 * PI, w2: 0.37, limit: 0.22 },
  { bone: 'neck' as VRMHumanBoneName, axis: 'x', base: 0, a1: -0.02 * PI, w1: 1.0, a2: -0.008 * PI, w2: 0.61, limit: 0.14 },
  { bone: 'neck' as VRMHumanBoneName, axis: 'y', base: 0, a1: 0.015 * PI, w1: 0.43, a2: 0.006 * PI, w2: 0.91, limit: 0.14 },
  { bone: 'leftUpperArm' as VRMHumanBoneName, axis: 'z', base: 1.3, a1: 0.012 * PI, w1: 0.53, a2: 0.005 * PI, w2: 1.17, limit: 0.12 },
  { bone: 'rightUpperArm' as VRMHumanBoneName, axis: 'z', base: -1.3, a1: -0.012 * PI, w1: 0.57, a2: -0.005 * PI, w2: 1.09, limit: 0.12 },
  { bone: 'leftUpperLeg' as VRMHumanBoneName, axis: 'z', base: -0.4, a1: -0.01 * PI, w1: 1.0, a2: -0.004 * PI, w2: 0.29, limit: 0.08 },
  { bone: 'rightUpperLeg' as VRMHumanBoneName, axis: 'z', base: 0.4, a1: 0.01 * PI, w1: 1.0, a2: 0.004 * PI, w2: 0.31, limit: 0.08 },
  { bone: 'leftLowerLeg' as VRMHumanBoneName, axis: 'x', base: -1.9, a1: 0.01 * PI, w1: 1.0, a2: 0.004 * PI, w2: 0.47, limit: 0.08 },
  { bone: 'rightLowerLeg' as VRMHumanBoneName, axis: 'x', base: -1.1, a1: 0.01 * PI, w1: 1.0, a2: 0.004 * PI, w2: 0.51, limit: 0.08 },
])

/** PURE. The authored idle's value for one channel at time `t` seconds. Also the fallback path. */
function authoredValue(c: Channel, t: number): number {
  return c.base + c.a1 * Math.sin(c.w1 * t) + c.a2 * Math.sin(c.w2 * t + 0.7)
}

/** PURE. The authored idle sampled at a fixed rate — the corpus the VAR model is fitted to. */
export function buildCorpus(seconds = CORPUS_SECONDS, sampleRateHz = SAMPLE_RATE_HZ): TrainingSequence {
  const frameCount = Math.max(1, Math.round(seconds * sampleRateHz))
  const frames: number[][] = new Array(frameCount)
  for (let i = 0; i < frameCount; i++) {
    const t = i / sampleRateHz
    const frame: number[] = new Array(CHANNELS.length)
    for (let c = 0; c < CHANNELS.length; c++) frame[c] = authoredValue(CHANNELS[c], t)
    frames[i] = frame
  }
  return { sampleRateHz, sourceDurationMs: (frameCount / sampleRateHz) * 1000, frames }
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/**
 * The VRM's idle animation.
 *
 * Drop-in for the previous deterministic ProceduralAnimation: same constructor, same `update(delta)`
 * contract, same resting silhouette — the motion between frames is what changed.
 */
export class StatisticalIdleAnimation {
  private vrm: VRM
  private elapsedTime = 0

  /** null whenever the model could not be fitted — the authored idle runs instead. */
  private generator: Generator<unknown> | null = null

  /** The two frames the render loop is currently interpolating between. */
  private prevFrame: number[] | null = null
  private nextFrame: number[] | null = null
  /** Seconds accumulated toward the next generated frame. */
  private frameClock = 0

  private readonly step = 1 / SAMPLE_RATE_HZ

  constructor(vrm: VRM, seed = 1) {
    this.vrm = vrm
    try {
      const model = createVarModel(buildCorpus(), { order: VAR_ORDER, ridge: VAR_RIDGE })
      const generator = model.toGenerator({ seed })
      // Prime the pair the interpolation reads. A generator that throws on its very first frame is
      // treated exactly like a failed fit rather than being discovered mid-render.
      this.prevFrame = generator.next().values
      this.nextFrame = generator.next().values
      this.generator = generator as Generator<unknown>
    } catch {
      // Too short, singular, or otherwise unfittable. The authored idle is the fallback, and it is
      // the same motion that shipped before this file existed.
      this.generator = null
    }
  }

  /** Whether the statistical model is actually driving this instance (false ⇒ authored fallback). */
  public get isStatistical(): boolean {
    return this.generator !== null
  }

  public update(delta: number): void {
    // A tab that was backgrounded returns a delta of many seconds. Stepping the generator that many
    // times would burn a visible hitch on the first frame back; the idle has no state worth
    // catching up on, so the step is bounded.
    const dt = Number.isFinite(delta) ? clamp(delta, 0, 0.25) : 0
    this.elapsedTime += dt

    const humanoid = this.vrm?.humanoid
    if (!humanoid) return

    const values = this.sample(dt)
    for (let i = 0; i < CHANNELS.length; i++) {
      const c = CHANNELS[i]
      const node = humanoid.getNormalizedBoneNode(c.bone)
      if (!node) continue // a VRM without this bone is valid; skip the channel rather than throw
      node.rotation[c.axis] = clamp(values[i], c.base - c.limit, c.base + c.limit)
    }
  }

  /** The channel values for this instant: interpolated model output, or the authored idle. */
  private sample(dt: number): number[] {
    const gen = this.generator
    if (!gen || !this.prevFrame || !this.nextFrame) {
      const out: number[] = new Array(CHANNELS.length)
      for (let i = 0; i < CHANNELS.length; i++) out[i] = authoredValue(CHANNELS[i], this.elapsedTime)
      return out
    }

    this.frameClock += dt
    // Advance as many whole model frames as real time has passed, bounded by the same 0.25s cap dt
    // already carries (so this loop can run at most ~8 times).
    while (this.frameClock >= this.step) {
      this.frameClock -= this.step
      this.prevFrame = this.nextFrame
      try {
        this.nextFrame = gen.next().values
      } catch {
        // The stream went numerically bad mid-show. Drop to the authored idle from here on — the
        // next `sample` takes the fallback branch, which is the same motion that shipped before
        // this file existed. There is a one-frame discontinuity as it hands over, and that is the
        // right trade: the alternatives are a statue (freezing on the last pair) or a throw inside
        // requestAnimationFrame, which blanks the stage for the rest of the stream.
        this.generator = null
        break
      }
    }

    const a = this.prevFrame!
    const b = this.nextFrame!
    const k = this.step > 0 ? clamp(this.frameClock / this.step, 0, 1) : 0
    const out: number[] = new Array(CHANNELS.length)
    for (let i = 0; i < CHANNELS.length; i++) out[i] = a[i] + (b[i] - a[i]) * k
    return out
  }
}
