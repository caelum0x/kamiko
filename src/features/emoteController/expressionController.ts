import * as THREE from "three";
import {
  VRM,
  VRMExpressionManager,
  VRMExpressionPresetName,
} from "@pixiv/three-vrm";
import { AutoLookAt } from "./autoLookAt";
import { AutoBlink } from "./autoBlink";
import { emotionNames } from "@/features/chat/messages";
import { stepBlends, type BlendState } from "./expressionBlend";
import { VRM_MOUTH_EXPRESSIONS, mouthDamp, vowelsToVrmWeights } from "@/features/lipSync/visemes";
import type { WLipSyncVowelWeights } from "@/airi/lipsync/shared/wlipsync";

/**
 * Expression management for the VRM face.
 *
 * Historically this class held one emotion at full weight and SNAPPED between them (setValue 0→1
 * in a single frame). Emotions now ease through expressionBlend.ts — fast attack, slower release —
 * so an [angry] → [happy] turn crossfades instead of jump-cutting, which is the difference between
 * a face and a mask on stream.
 *
 * The mouth has two modes:
 *   - viseme mode (airi's wLipSync via LipSync.vowelFrame): the five VRM mouth presets driven by
 *     classified vowels — `lipSyncVisemes` receives the driver's weights each frame;
 *   - the original volume mode (`lipSync('aa', volume)`) as the fallback when the worklet is
 *     unavailable. Same damping idea in both: an emotion held on the face halves the mouth.
 */
export class ExpressionController {
  private _autoLookAt: AutoLookAt;
  private _autoBlink?: AutoBlink;
  private _expressionManager?: VRMExpressionManager;
  private _currentEmotion: VRMExpressionPresetName | string;
  /** Eased weights for emotion expressions (never the mouth — that is written every frame). */
  private _blends: Map<string, BlendState>;
  private _currentLipSync: {
    preset: VRMExpressionPresetName | string;
    value: number;
  } | null;
  /** Latest viseme frame; null ⇒ volume mode. Cleared each update so a stale frame cannot stick. */
  private _currentVisemes: WLipSyncVowelWeights | null;
  constructor(vrm: VRM, camera: THREE.Object3D) {
    this._autoLookAt = new AutoLookAt(vrm, camera);
    this._currentEmotion = "neutral";
    this._currentLipSync = null;
    this._currentVisemes = null;
    this._blends = new Map();
    this.registerExpression(vrm)
    if (vrm.expressionManager) {
      this._expressionManager = vrm.expressionManager;
      this._autoBlink = new AutoBlink(vrm.expressionManager);
    }
  }

  public registerExpression(vrm: VRM) {
    const expressionManager = vrm.expressionManager;
    if (!expressionManager) return;

    const { expressionMap: allExpressions, presetExpressionMap: presetExpressions } = expressionManager;
    const oddExpressions = Object.keys(allExpressions).filter(key => !(key in presetExpressions));

    oddExpressions.forEach(expressionName => {
      const expression = allExpressions[expressionName];
      if (expression) expressionManager.registerExpression(expression);
    });

    const allExpressionNames = Object.keys(allExpressions);
    emotionNames.push(...allExpressionNames);

    return allExpressionNames;
  }

  public playEmotion(preset: VRMExpressionPresetName | string) {
    const normalizedPreset = `${preset.charAt(0).toUpperCase()}${preset.slice(1)}`;

    if (this._currentEmotion == preset) {
      return;
    }

    // Release the previous emotion through the blend (slow tau), not by snapping it to zero.
    if (this._currentEmotion != "neutral") {
      this.setBlendTarget(this._currentEmotion, 0);
    }

    if (preset == "neutral") {
      this._autoBlink?.setEnable(true);
      this._currentEmotion = preset;
      return;
    }

    const value = (normalizedPreset in VRMExpressionPresetName) ? (normalizedPreset === "Surprised" ? 0.5 : 1) : 0.5;

    const t = this._autoBlink?.setEnable(false) || 0;
    this._currentEmotion = preset;
    setTimeout(() => {
      // Only if this is still the emotion we are heading for — a rapid [a][b] pair must not have
      // a stale timer land [a] on top of [b].
      if (this._currentEmotion === preset) this.setBlendTarget(preset, value);
    }, t * 1000);
  }

  private setBlendTarget(preset: string, target: number) {
    const existing = this._blends.get(preset);
    this._blends.set(preset, { target, current: existing?.current ?? 0 });
  }

  public lipSync(preset: VRMExpressionPresetName | string, value: number) {
    if (this._currentLipSync) {
      this._expressionManager?.setValue(this._currentLipSync.preset, 0);
    }
    this._currentLipSync = {
      preset,
      value,
    };
  }

  /**
   * Viseme mode: the smoothed vowel weights for THIS frame (airi's vowel driver). Takes
   * precedence over the volume mouth for as long as frames keep arriving.
   */
  public lipSyncVisemes(vowels: WLipSyncVowelWeights) {
    this._currentVisemes = vowels;
  }

  /** The emotion currently held on the face — read by the idle driver to modulate motion. */
  public get currentEmotion(): string {
    return String(this._currentEmotion);
  }

  public update(delta: number) {
    if (this._autoBlink) {
      this._autoBlink.update(delta);
    }

    // Ease every emotion expression toward its target and write the frame's weights.
    if (this._blends.size > 0) {
      const { next, weights } = stepBlends(this._blends, delta);
      this._blends = next;
      for (const [name, weight] of weights) {
        this._expressionManager?.setValue(name, weight);
      }
    }

    if (this._currentVisemes) {
      // Viseme mouth: write all five presets every frame (a vowel that fell to 0 must close).
      const damp = mouthDamp(String(this._currentEmotion));
      const weights = vowelsToVrmWeights(this._currentVisemes, damp);
      for (const name of VRM_MOUTH_EXPRESSIONS) {
        this._expressionManager?.setValue(name, weights[name]);
      }
      this._currentVisemes = null; // one frame's data drives one frame
    } else if (this._currentLipSync) {
      const weight =
        this._currentEmotion === "neutral"
          ? this._currentLipSync.value * 0.5
          : this._currentLipSync.value * 0.25;
      this._expressionManager?.setValue(this._currentLipSync.preset, weight);
    }
  }
}
