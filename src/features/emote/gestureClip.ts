/**
 * gestureClip.ts — turn a bundled `.vrma` into the few seconds of it an emote actually wants.
 *
 * TWO EDITS, BOTH LOAD-BEARING.
 *
 * 1. THE WINDOW. The clips are long and mostly hold: `peaceSign.vrma` runs 11.7 seconds, of which
 *    0.0–0.5s is standing still and 1.2–10.0s is the same pose held rigid. `Model.playAnimation`
 *    could only play a clip whole, so "do the peace sign" meant eleven seconds of frozen avatar
 *    followed by a return to idle — a freeze, not a gesture. Slicing gives back the beat: form the
 *    pose, hold it long enough to read, cross-fade home.
 *
 * 2. THE HIPS DO NOT TRAVEL. `VRMC_vrm_animation` allows exactly one translation channel — the
 *    hips — and the source clips use it, so playing one moves the character off her mark. amica's
 *    existing answer was `modifyAnimationPosition`, which rewrites every hips keyframe by an offset
 *    scaled by a per-clip fudge factor (`{x: 2, y: 1.25, z: 1.5}` for the dance, `{x:1,y:1,z:0}` for
 *    everything else) — magic numbers tuned against one model, and wrong for any other. An emote is
 *    an overlay on a character who is standing where the idle put her, so the translation channel is
 *    simply dropped: the rotations are the gesture, and the hips stay where they were.
 *
 * The slicing is kept PURE (`sliceTimes`) so the arithmetic that decides which keyframes survive is
 * testable without a WebGL context, a VRM, or a 1.3MB fixture.
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

import type { GestureClip } from './emotes';
import type { VRMAnimation } from '@/lib/VRMAnimation/VRMAnimation';

/**
 * PURE. Which keyframe indices of `times` fall inside [start, end], and what their new times are.
 *
 * Guarantees, in the order they matter:
 *   - NEVER EMPTY. A track whose keys all fall outside the window (a bone that is keyed once, at
 *     t=0, and never again — common in authored clips) collapses to its single nearest key, held
 *     constant. A `KeyframeTrack` with zero keys throws inside three's interpolant on the first
 *     frame, which kills the render loop, so "no keys in range" can never be the answer.
 *   - REBASED TO ZERO. The window's first key lands at t=0 so the action can be played from its
 *     start; negative times (a boundary key just before `start`) clamp to 0 rather than making the
 *     clip's duration disagree with its own keys.
 *   - NON-DECREASING. `times` is assumed sorted, as the glTF spec requires of an animation input
 *     accessor; the clamp above is the only place that could tie two keys, and equal times are
 *     legal in three.
 */
export function sliceTimes(
  times: ArrayLike<number>,
  start: number,
  end: number,
): { indices: number[]; times: number[] } {
  const n = times.length;
  if (n === 0) return { indices: [], times: [] };

  const lo = Number.isFinite(start) ? start : 0;
  const hi = Number.isFinite(end) && end > lo ? end : lo;

  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = times[i];
    if (t >= lo && t <= hi) indices.push(i);
  }

  if (indices.length === 0) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(times[i] - lo);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return { indices: [best], times: [0] };
  }

  const base = times[indices[0]];
  return { indices, times: indices.map((i) => Math.max(0, times[i] - base)) };
}

/** Rebuild one track over the sliced keys. Returns null when the track cannot be represented. */
function sliceTrack(track: THREE.KeyframeTrack, start: number, end: number): THREE.KeyframeTrack | null {
  const { indices, times } = sliceTimes(track.times, start, end);
  if (indices.length === 0) return null;

  const stride = track.getValueSize();
  const values = new Float32Array(indices.length * stride);
  for (let k = 0; k < indices.length; k++) {
    const src = indices[k] * stride;
    for (let c = 0; c < stride; c++) values[k * stride + c] = track.values[src + c];
  }

  // Same concrete track class (Quaternion/Vector/Number), so three keeps the right interpolant —
  // slerp for quaternions in particular, which a plain KeyframeTrack would not do.
  const Ctor = (track as unknown as { constructor: new (n: string, t: ArrayLike<number>, v: ArrayLike<number>) => THREE.KeyframeTrack }).constructor;
  return new Ctor(track.name, times, values);
}

/**
 * The clip an emote plays: `gesture`'s window of `animation`, retargeted onto `vrm`, with the hips
 * translation dropped. Returns null when the window leaves nothing playable — the caller then does
 * the face half of the emote alone, which is a working emote, rather than throwing on the stage.
 */
export function buildGestureClip(
  animation: VRMAnimation | THREE.AnimationClip,
  vrm: VRM,
  gesture: GestureClip,
  name: string,
): THREE.AnimationClip | null {
  const source =
    animation instanceof THREE.AnimationClip ? animation : animation.createAnimationClip(vrm);

  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of source.tracks) {
    if (track.name.endsWith('.position')) continue; // the hips do not travel — see the header
    const sliced = sliceTrack(track, gesture.start, gesture.end);
    if (sliced) tracks.push(sliced);
  }
  if (tracks.length === 0) return null;

  const clip = new THREE.AnimationClip(name, -1, tracks);
  clip.resetDuration();
  return clip.duration > 0 ? clip : null;
}
