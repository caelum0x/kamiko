import type { VRM } from '@pixiv/three-vrm';
import { approach, type VrmFacePose } from './arkitToVrm';

/**
 * faceDriver.ts — the operator's tracked face, written onto the VRM, without fighting anything.
 *
 * THREE SYSTEMS ALREADY DRIVE THIS AVATAR'S FACE AND BONES, and the whole job of this file is to
 * take exactly the parts none of them owns:
 *
 *   1. THE LIP-SYNC owns the mouth while she is SPEAKING. It is driven by the actual audio of the
 *      line she is delivering, and it is better at a mouth than a webcam interpretation of a jaw
 *      ever will be. So the mouth is only taken while she is silent — the operator can mug at the
 *      camera between lines, and the instant she starts talking the mouth goes back to the audio.
 *   2. THE EMOTE CONTROLLER owns the emotion presets (happy/angry/sad/relaxed), which the bridge
 *      selects per line via the `[emotion]` tag. Those are semantic — her reaction to what SHE is
 *      saying — so they are never written here. arkitToVrm.ts declines to map them at all.
 *   3. THE STATISTICAL IDLE owns the body. This writes only the HEAD bone, and only after the idle
 *      pass has run, so the two do not double-drive the same transform.
 *
 * The eyes and brows have no other owner while tracking is on, so they are taken outright — except
 * the blink, which the auto-blinker also writes: a tracked face supplies real blinks, and two
 * systems blinking independently reads as a nervous tic.
 *
 * EVERYTHING IS SMOOTHED AND EVERYTHING IS BOUNDED. The camera runs at ~30fps against a renderer at
 * 60–144, so raw values step visibly; `approach` eases them frame-rate independently. And when the
 * face is lost — the operator leans out of frame, the tab is backgrounded — the pose eases back to
 * neutral rather than freezing, because a frozen face is uncanny in a way a relaxed one is not.
 */

/** The VRM expression names this driver is allowed to write. Nothing else is touched. */
const OWNED_EXPRESSIONS = [
  'aa', 'ih', 'ou', 'ee', 'oh',
  'blink', 'blinkLeft', 'blinkRight',
  'lookUp', 'lookDown', 'lookLeft', 'lookRight',
  'browInnerUp', 'browOuterUp', 'browDown',
] as const;

/** The mouth vowels, which are handed back to the lip-sync whenever she is speaking. */
const MOUTH = new Set(['aa', 'ih', 'ou', 'ee', 'oh']);

export interface FaceDriver {
  /**
   * Write the expression half. Call BEFORE `vrm.update()`, so the values reach the mesh on the
   * same frame rather than one behind.
   */
  applyExpressions(vrm: VRM, pose: VrmFacePose | null, delta: number, speaking: boolean): void;
  /**
   * Write the head rotation. Call AFTER the procedural idle, which also writes bones — last writer
   * wins, and for the head while tracking is on, that should be the operator.
   */
  applyHead(vrm: VRM, pose: VrmFacePose | null, delta: number): void;
  /** Forget the smoothed state, so a restart does not ease out of a stale face. */
  reset(): void;
}

export function createFaceDriver(): FaceDriver {
  /** The smoothed value currently applied, per expression. */
  const current = new Map<string, number>();
  let headPitch = 0;
  let headYaw = 0;
  let headRoll = 0;

  return {
    applyExpressions(vrm, pose, delta, speaking) {
      const manager = vrm.expressionManager;
      if (!manager) return;

      for (const name of OWNED_EXPRESSIONS) {
        /*
         * A LOST FACE EASES TO NEUTRAL, IT DOES NOT FREEZE. `pose` is null when the tracker has no
         * result — the operator left the frame, the tab was backgrounded, the model is still
         * loading. Holding the last frame leaves a face locked mid-expression, which reads as the
         * avatar having crashed; easing to zero reads as her relaxing.
         */
        const target = pose?.tracked ? pose.expressions[name] ?? 0 : 0;

        // THE MOUTH IS THE LIP-SYNC'S WHILE SHE IS SPEAKING. Writing a webcam jaw over the audio's
        // viseme mouth is the one way this feature could make her look WORSE than not having it.
        if (speaking && MOUTH.has(name)) {
          current.delete(name);
          continue;
        }

        const next = approach(current.get(name) ?? 0, target, delta);
        current.set(name, next);
        /*
         * Values below a threshold are written as a hard zero rather than as 0.0003. An expression
         * left at a hair above zero keeps the VRM's expression manager marking the mesh dirty every
         * frame forever, and on models whose blink is a bone rather than a morph it leaves the eyes
         * fractionally closed.
         */
        manager.setValue(name, next < 0.01 ? 0 : next);
      }
    },

    applyHead(vrm, pose, delta) {
      const head = vrm.humanoid?.getNormalizedBoneNode('head');
      if (!head) return;
      const target = pose?.tracked ? pose.head : { pitch: 0, yaw: 0, roll: 0 };
      // A longer time constant than the face: a head is heavy, and the same easing that looks
      // right on an eyelid looks twitchy on a neck.
      headPitch = approach(headPitch, target.pitch, delta, 0.12);
      headYaw = approach(headYaw, target.yaw, delta, 0.12);
      headRoll = approach(headRoll, target.roll, delta, 0.12);
      /*
       * SET, NOT ADD. The procedural idle has already written this bone for the frame, and adding
       * to it would let the two accumulate into a head that drifts further from centre the longer
       * the show runs. While the operator is driving, the operator's value IS the head.
       */
      head.rotation.set(headPitch, headYaw, headRoll);
    },

    reset() {
      current.clear();
      headPitch = 0;
      headYaw = 0;
      headRoll = 0;
    },
  };
}
