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

/** Mouth weight below which she counts as SILENT and an emote may hold her mouth open. */
const SPEAKING_FLOOR = 0.02;

/** The eyelid expressions. An emote that writes one of these has to own the auto-blink too. */
const EYELIDS: readonly string[] = Object.freeze(["blink", "blinkLeft", "blinkRight"]);

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
 *
 * ON TOP OF ALL THAT SITS THE EMOTE FACE (`playEmoteFace`). An emotion is ONE expression at one
 * weight, which is enough for a mood and cannot spell a gesture: a wink is one eyelid plus half a
 * smile, a bleh is one eyelid plus an open mouth plus a smile. So an emote writes SEVERAL
 * expressions together, for a fixed hold, and then gives the face back to whatever emotion she was
 * wearing. Three collisions had to be settled for that to be true rather than approximately true:
 *
 *   - THE EMOTION. Held down to zero for the duration and restored on release, so a `sad` at full
 *     weight cannot fight the smile the emote is made of.
 *   - THE AUTO-BLINK. Disabled only when the emote actually owns an eyelid; a stonks pose has no
 *     business stopping her from blinking for three seconds.
 *   - THE MOUTH, which is written EVERY frame by the lip-sync whether or not there is audio. An
 *     emote's mouth is therefore written LAST and only while she is silent; the moment real speech
 *     energy arrives the emote's mouth is released and the lip-sync has it back mid-emote. Speech
 *     always wins the mouth — an avatar that mouths a word wrong is worse than a dropped emote.
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
  /** Expressions the running emote owns; empty when no emote is held. */
  private _emoteKeys: Set<string>;
  /** The subset of those that are mouth presets — the ones the lip-sync would otherwise overwrite. */
  private _emoteMouth: Set<string>;
  /** Seconds left on the emote hold. */
  private _emoteHold: number;
  /** The emotion the emote borrowed the face from, to be restored on release. */
  private _emoteRestore: string | null;
  constructor(vrm: VRM, camera: THREE.Object3D) {
    this._autoLookAt = new AutoLookAt(vrm, camera);
    this._currentEmotion = "neutral";
    this._currentLipSync = null;
    this._currentVisemes = null;
    this._blends = new Map();
    this._emoteKeys = new Set();
    this._emoteMouth = new Set();
    this._emoteHold = 0;
    this._emoteRestore = null;
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

  /** The expression names this VRM actually has — what emotes are resolved against. */
  public get availableExpressions(): ReadonlySet<string> {
    return new Set(Object.keys(this._expressionManager?.expressionMap ?? {}));
  }

  public playEmotion(preset: VRMExpressionPresetName | string) {
    // A new emotion means she is being driven by the chat again; an emote in flight is over.
    if (this._emoteKeys.size > 0) this.releaseEmote(false);

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

    const value = ExpressionController.emotionWeight(normalizedPreset);

    const t = this._autoBlink?.setEnable(false) || 0;
    this._currentEmotion = preset;
    setTimeout(() => {
      // Only if this is still the emotion we are heading for — a rapid [a][b] pair must not have
      // a stale timer land [a] on top of [b].
      if (this._currentEmotion === preset) this.setBlendTarget(preset, value);
    }, t * 1000);
  }

  /** The weight `playEmotion` holds an emotion at — a preset at full, a custom shape at half. */
  private static emotionWeight(normalizedPreset: string): number {
    return normalizedPreset in VRMExpressionPresetName
      ? normalizedPreset === "Surprised"
        ? 0.5
        : 1
      : 0.5;
  }

  /**
   * Hold several expressions together for `holdSeconds`, then give the face back.
   *
   * `weights` has already been resolved against this model (features/emote/emotes.ts
   * `resolveFace`), so every name here is one the VRM has. An empty map is a no-op rather than a
   * blanked face — the caller falls back to the emote's mood in that case.
   */
  public playEmoteFace(weights: Readonly<Record<string, number>>, holdSeconds: number): void {
    const names = Object.keys(weights);
    if (names.length === 0) return;

    // Clean up whatever was held before, WITHOUT restoring the emotion — this emote is about to
    // borrow the face from the same place, and restoring it here would flash it for one frame.
    if (this._emoteKeys.size > 0) this.releaseEmote(false);

    if (this._currentEmotion !== "neutral") {
      this._emoteRestore = String(this._currentEmotion);
      this.setBlendTarget(this._emoteRestore, 0);
    }

    for (const name of names) this.setBlendTarget(name, weights[name]);

    this._emoteKeys = new Set(names);
    this._emoteMouth = new Set(names.filter((n) => (VRM_MOUTH_EXPRESSIONS as readonly string[]).includes(n)));
    this._emoteHold = Number.isFinite(holdSeconds) && holdSeconds > 0 ? holdSeconds : 0;

    // Only take the blink when the emote is actually made of eyelids.
    if (names.some((n) => EYELIDS.includes(n))) this._autoBlink?.setEnable(false);
  }

  /** Whether an emote is currently holding the face. */
  public get emoteActive(): boolean {
    return this._emoteKeys.size > 0;
  }

  /**
   * Let go of the emote. `restore` re-arms the emotion the emote borrowed the face from; the
   * `false` case is for a handover — something else is about to write the face this frame.
   */
  private releaseEmote(restore: boolean): void {
    for (const name of this._emoteKeys) this.setBlendTarget(name, 0);
    this._emoteKeys.clear();
    this._emoteHold = 0;

    const back = this._emoteRestore;
    this._emoteRestore = null;
    if (restore && back && back === this._currentEmotion) {
      const normalized = `${back.charAt(0).toUpperCase()}${back.slice(1)}`;
      this.setBlendTarget(back, ExpressionController.emotionWeight(normalized));
    }

    // The blink comes back unless the emotion she is returning to still wants it off.
    this._autoBlink?.setEnable(this._currentEmotion === "neutral");
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

    // The emote's clock, BEFORE the blends step — so the frame it expires on is already easing out.
    if (this._emoteKeys.size > 0 && this._emoteHold > 0) {
      if (Number.isFinite(delta) && delta > 0) this._emoteHold -= delta;
      if (this._emoteHold <= 0) this.releaseEmote(true);
    }

    // Ease every emotion expression toward its target and write the frame's weights.
    let blended: Map<string, number> | null = null;
    if (this._blends.size > 0) {
      const { next, weights } = stepBlends(this._blends, delta);
      this._blends = next;
      blended = new Map(weights);
      for (const [name, weight] of weights) {
        this._expressionManager?.setValue(name, weight);
      }
    }

    // How much of the mouth the AUDIO is using this frame. `speaking` decides who owns it.
    let speaking = false;
    if (this._currentVisemes) {
      // Viseme mouth: write all five presets every frame (a vowel that fell to 0 must close).
      const damp = mouthDamp(String(this._currentEmotion));
      const weights = vowelsToVrmWeights(this._currentVisemes, damp);
      for (const name of VRM_MOUTH_EXPRESSIONS) {
        if (weights[name] > SPEAKING_FLOOR) speaking = true;
        this._expressionManager?.setValue(name, weights[name]);
      }
      this._currentVisemes = null; // one frame's data drives one frame
    } else if (this._currentLipSync) {
      const weight =
        this._currentEmotion === "neutral"
          ? this._currentLipSync.value * 0.5
          : this._currentLipSync.value * 0.25;
      speaking = weight > SPEAKING_FLOOR;
      this._expressionManager?.setValue(this._currentLipSync.preset, weight);
    }

    /*
     * THE EMOTE'S MOUTH, LAST. The lip-sync above writes the mouth on every single frame — silence
     * included, because `Model.update` calls `lipSync('aa', volume)` unconditionally — so an emote
     * that wants an open mouth (the bleh) has to write after it, or it never appears at all. Real
     * speech energy takes the mouth straight back: the emote's mouth is released, and its blend
     * eases to zero under the lip-sync rather than snapping.
     */
    if (this._emoteMouth.size > 0) {
      if (speaking) {
        for (const name of this._emoteMouth) this.setBlendTarget(name, 0);
        this._emoteMouth.clear();
      } else if (blended) {
        for (const name of this._emoteMouth) {
          const w = blended.get(name);
          if (w !== undefined) this._expressionManager?.setValue(name, w);
        }
        // Drop the ones that have finished releasing, so the set does not outlive the emote.
        for (const name of Array.from(this._emoteMouth)) {
          if (!this._blends.has(name)) this._emoteMouth.delete(name);
        }
      }
    }
  }
}
