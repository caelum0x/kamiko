import * as THREE from "three";
import { VRM, VRMExpressionPresetName } from "@pixiv/three-vrm";
import { ExpressionController } from "./expressionController";

/**
 * 感情表現としてExpressionとMotionを操作する為のクラス
 * デモにはExpressionのみが含まれています
 */
export class EmoteController {
  private _expressionController: ExpressionController;

  constructor(vrm: VRM, camera: THREE.Object3D) {
    this._expressionController = new ExpressionController(vrm, camera);
  }

  public playEmotion(preset: VRMExpressionPresetName | string) {
    this._expressionController.playEmotion(preset);
  }

  /**
   * The FACE half of an emote — several expressions held together for a fixed beat, then handed
   * back to the emotion underneath. See ExpressionController.playEmoteFace for who wins the mouth.
   */
  public playEmoteFace(weights: Readonly<Record<string, number>>, holdSeconds: number) {
    this._expressionController.playEmoteFace(weights, holdSeconds);
  }

  /** The expression names the loaded VRM really has — emotes are resolved against this. */
  public get availableExpressions(): ReadonlySet<string> {
    return this._expressionController.availableExpressions;
  }

  /** Whether an emote is holding the face right now. */
  public get emoteActive(): boolean {
    return this._expressionController.emoteActive;
  }

  public lipSync(preset: VRMExpressionPresetName | string, value: number) {
    this._expressionController.lipSync(preset, value);
  }

  /** Viseme mouth (airi wLipSync) — see ExpressionController.lipSyncVisemes. */
  public lipSyncVisemes(vowels: import("@/airi/lipsync/shared/wlipsync").WLipSyncVowelWeights) {
    this._expressionController.lipSyncVisemes(vowels);
  }

  /** The emotion currently on the face — the idle driver reads this to modulate motion. */
  public get currentEmotion(): string {
    return this._expressionController.currentEmotion;
  }

  public update(delta: number) {
    this._expressionController.update(delta);
  }
}