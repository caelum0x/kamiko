import * as THREE from "three";
import {
  MToonMaterial,
  MToonMaterialLoaderPlugin,
  VRM,
  VRMLoaderPlugin,
  VRMUtils,
} from "@pixiv/three-vrm";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { VRMAnimation } from "@/lib/VRMAnimation/VRMAnimation";
import { VRMLookAtSmootherLoaderPlugin } from "@/lib/VRMLookAtSmootherLoaderPlugin/VRMLookAtSmootherLoaderPlugin";
import { LipSync } from "@/features/lipSync/lipSync";
import { EmoteController } from "@/features/emoteController/emoteController";
/*
 * The idle animation is airi's statistical motion model (merged into src/airi/motion), not the
 * single-tone sine loop it replaced — see statisticalIdle.ts. It keeps the same constructor and the
 * same update(delta) contract, so this is a drop-in; it falls back to the authored idle by itself if
 * the model cannot be fitted, and never throws inside the render loop.
 */
import { StatisticalIdleAnimation } from "@/features/proceduralAnimation/statisticalIdle";
import { createFaceTracker, type FaceTracker } from "@/features/faceTracking/faceTracker";
import { createFaceDriver, type FaceDriver } from "@/features/faceTracking/faceDriver";
import { applyKamikoLook } from "@/features/vrmViewer/kamikoLook";
import { loadVRMAnimation } from "@/lib/VRMAnimation/loadVRMAnimation";
import { buildGestureClip } from "@/features/emote/gestureClip";
import { EMOTES, resolveFace, type Emote, type GestureClip } from "@/features/emote/emotes";
import { Screenplay } from "@/features/chat/messages";
import { downscaleModelTextures, logTextureInfo } from '@/utils/textureDownscaler';
import { OptimizedGLTFLoader } from '@/utils/gltfOptimizer';
import { GLTFAnalyzer } from '@/utils/gltfAnalyzer';
import { TransparencyOptimizer, checkAndOptimizeTransparency } from '@/utils/transparencyOptimizer';
import { config } from "@/utils/config";

/**
 * 3Dキャラクターを管理するクラス
 */
export class Model {
  public vrm?: VRM | null;
  public mixer?: THREE.AnimationMixer;
  public emoteController?: EmoteController;
  public proceduralAnimation?: StatisticalIdleAnimation;
  /**
   * OPERATOR PUPPETEERING (src/features/faceTracking). Built lazily on the first startFaceTracking()
   * so a visitor who never turns it on pays for none of it — not the module, not the WASM, not the
   * face model.
   */
  private _faceTracker?: FaceTracker;
  private _faceDriver?: FaceDriver;

  private _lookAtTargetParent: THREE.Object3D;
  public _lipSync?: LipSync;

  public _currentAction?: THREE.AnimationAction;

  /**
   * THE RUNNING EMOTE GESTURE, and its fade-out, both clocked by the RENDER LOOP rather than by
   * `setTimeout`. A backgrounded tab stops requestAnimationFrame and keeps firing timers, so a
   * timer-driven gesture ends while the mixer that is playing it is frozen — the avatar comes back
   * to a foreground tab mid-pose with nothing left to take her out of it.
   */
  private _gesture?: { action: THREE.AnimationAction; fadeLeft: number };

  /** Seconds left of the emote's borrowed idle temperament (see playEmote). */
  private _emoteMoodLeft = 0;

  /** Seconds the gesture crossfades in and out over — short enough to read as one motion. */
  private static readonly GESTURE_FADE_S = 0.4;

  constructor(lookAtTargetParent: THREE.Object3D) {
    this._lookAtTargetParent = lookAtTargetParent;
    this._lipSync = new LipSync(new AudioContext());
  }

  public async loadVRM(
    url: string,
    setLoadingProgress: (progress: string) => void,
  ): Promise<void> {
    const loader = new GLTFLoader();
    /*
    const loader = new OptimizedGLTFLoader({
      // Texture optimizations
      skipTextures: true,          // Skip loading textures completely
      maxTextureSize: 512,         // Maximum texture size
      generateMipmaps: false,      // Disable mipmaps
      
      // Geometry optimizations
      skipDraco: true,            // Skip Draco decoder setup
      preserveIndices: false,     // Remove index buffers
      
      // Animation/Material optimizations
      skipAnimations: true,       // Skip loading animations
      simplifyMaterials: true,    // Use simplified materials
      disableNormalMaps: true,    // Disable normal maps
      
      // Performance optimizations
      disposeSourceData: true,    // Clear source data after load
      
      // Optional callbacks for fine-tuning
      onMesh: (mesh) => {
        // Custom mesh optimizations
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      },
      onMaterial: (material) => {
        // Custom material optimizations
        if (material instanceof THREE.MeshStandardMaterial) {
          material.envMapIntensity = 0;
        }
      },
      onTexture: (texture) => {
        // Custom texture optimizations
        texture.encoding = THREE.LinearEncoding;
      },
    });
    */

    // used for debug rendering
    const helperRoot = new THREE.Group();
    helperRoot.renderOrder = 10000;

    // the type of material to use
    // should usually be MToonMaterial
    let materialType: any;
    switch (config("mtoon_material_type")) {
      case "mtoon":
        materialType = MToonMaterial;
        break;
      case "mtoon_node":
        // @ts-ignore
        const { MToonNodeMaterial } = await import("@pixiv/three-vrm/nodes");
        materialType = MToonNodeMaterial;
        break;
      case "meshtoon":
        materialType = THREE.MeshToonMaterial;
        break;
      case "basic":
        materialType = THREE.MeshBasicMaterial;
        break;
      case "depth":
        materialType = THREE.MeshDepthMaterial;
        break;
      case "normal":
        materialType = THREE.MeshNormalMaterial;
        break;
      default:
        console.error("mtoon_material_type not found");
        break;
    }

    if (config("use_webgpu") === "true") {
      // create a WebGPU compatible MToonMaterialLoaderPlugin
      // @ts-ignore
      // TODO currently MToonNodeMaterial is broken in amica
      // materialType = MTonNodeMaterial;
    }

    loader.register((parser) => {
      const options: any = {
        lookAtPlugin: new VRMLookAtSmootherLoaderPlugin(parser),
        mtoonMaterialPlugin: new MToonMaterialLoaderPlugin(parser, {
          materialType,
        }),
      };

      if (config("debug_gfx") === "true") {
        options.helperRoot = helperRoot;
      }

      return new VRMLoaderPlugin(parser, options);
    });

    return new Promise((resolve, reject) => {
      loader.load(
        url,
        async (gltf) => {
          // Temp Disable : WebXR
          // setLoadingProgress("Processing VRM");

          /*
          {
            const analyzer = new GLTFAnalyzer();
            const stats = analyzer.analyzeModel(gltf);
            console.log('Model Statistics:', stats);
            const suggestions = analyzer.suggestOptimizations(stats);
            console.log('Optimization Suggestions:', suggestions);
          }
          {
            // Or for more control:
            const optimizer = new TransparencyOptimizer();
            const stats = optimizer.analyzeTransparency(gltf);
            console.log('Transparency analysis:', stats);
            // Check for issues
            const issues = optimizer.logTransparencyIssues();
            console.log('Transparency issues:', issues);

            // Apply optimizations
            optimizer.optimizeTransparency(gltf, {
              disableTransparency: true,     // Completely disable all transparency
              minAlphaThreshold: 0.9,        // Convert nearly opaque materials to fully opaque
              convertToAlphaTest: false,      // Convert transparency to alphaTest where possible
              alphaTestThreshold: 0.5        // Threshold for alphaTest conversion
            });
          }
          */

          const vrm = (this.vrm = gltf.userData.vrm);
          vrm.scene.name = "VRMRoot";

          VRMUtils.removeUnnecessaryVertices(gltf.scene);
          VRMUtils.removeUnnecessaryJoints(gltf.scene);

          // Mobile 15MB-model relief: opt-in texture downscale (config flag, default off). Runs after
          // the VRM is bound but before it enters the scene, so the render loop never sees the large
          // textures. downscaleModelTextures re-encodes in place and resolves regardless of failures.
          if (config("model_downscale_textures") === "true") {
            const maxDim = parseInt(config("model_downscale_max"), 10);
            const safeMaxDim = Number.isFinite(maxDim) && maxDim > 0 ? maxDim : 512;
            try {
              await downscaleModelTextures(gltf, safeMaxDim);
            } catch (e) {
              console.error("model_downscale_textures failed; using original textures", e);
            }
          }

          const mtoonDebugMode = config("mtoon_debug_mode");
          vrm.scene.traverse((obj: any) => {
            obj.frustumCulled = false;

            if (mtoonDebugMode !== "none") {
              if (obj.material) {
                if (Array.isArray(obj.material)) {
                  obj.material.forEach((mat: any) => {
                    if (mat.isMToonMaterial) {
                      mat.debugMode = mtoonDebugMode;
                    }
                  });
                } else {
                  if (obj.material.isMToonMaterial) {
                    obj.material.debugMode = mtoonDebugMode;
                  }
                }
              }
            }
          });

          // Kamiko's signature: the awake neon-green glowing eye (BRAND heterochromia). Cosmetic and
          // defensive — never throws, no-ops if the model has no iris material. Runs after the traverse
          // above so material types are settled.
          if (config("kamiko_heterochromia") !== "false") {
            applyKamikoLook(vrm);
          }

          // this.setTransparency(0.5);

          if (config("debug_gfx") === "true") {
            vrm.scene.add(helperRoot);
          }

          // TODO this causes helperRoot to be rendered to side
          // VRMUtils.rotateVRM0(vrm);
          // hacky fix
          if (vrm.meta?.metaVersion === "0") {
            vrm.scene.rotation.y = Math.PI;
            helperRoot.rotation.y = Math.PI;
          }

          this.mixer = new THREE.AnimationMixer(vrm.scene);

          this.emoteController = new EmoteController(
            vrm,
            this._lookAtTargetParent,
          );

          this.proceduralAnimation = new StatisticalIdleAnimation(vrm);

          resolve();
        },
        (xhr) => {
          // Temp Disable : WebXR
          // setLoadingProgress(
          //   `${Math.floor((xhr.loaded / xhr.total) * 10000) / 100}% loaded`,
          // );
        },
        (error) => {
          reject(error);
        },
      );
    });
  }

  public setTransparency(opacity: number) {
    if (! this.vrm) {
      return;
    }

    this.vrm.scene.traverse((obj: any) => {
      obj.frustumCulled = false;

      if (obj.isMesh) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((mat: any) => {
            mat.transparent = true;
            mat.opacity = opacity;
            mat.alphaTest = 0;
          });
        } else if (obj.material) {
          obj.material.transparent = true;
          obj.material.opacity = opacity;
          obj.material.alphaTest = 0;
        }
      }
    });
  }

  public unLoadVrm() {
    // A gesture in flight holds a mixer action bound to bones that are about to be disposed, and
    // its render-loop fade-out would keep ticking against a null VRM.
    this.stopGesture();
    this._emoteMoodLeft = 0;
    if (this.vrm) {
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
    }
  }

  /**
   * VRMアニメーションを読み込む
   *
   * https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/README.ja.md
   */
  public async loadAnimation(
    animation: VRMAnimation | THREE.AnimationClip,
  ): Promise<void> {
    const { vrm, mixer } = this;
    if (vrm == null || mixer == null) {
      throw new Error("You have to load VRM first");
    }

    const clip =
      animation instanceof THREE.AnimationClip
        ? animation
        : animation.createAnimationClip(vrm);
    mixer.stopAllAction();
    this._currentAction = mixer.clipAction(clip);
    this._currentAction.play();
  }

  /**
   * Cross-fade to `destAction`. `undefined` means "fade the current action out and leave the rig to
   * whoever else is writing it" — with the statistical idle on (the default) there IS no idle
   * action to return to, and the previous version dereferenced `this._currentAction` unconditionally
   * right here. That is not a hypothetical: `playAnimation` captured `this._currentAction!` as the
   * action to restore, so every `.vrma` played on a default install threw a TypeError inside the
   * mixer's `finished` handler, which is how amicaLife's idle-animation event and the /api SSE
   * `animation` message both ended.
   */
  private async fadeToAction(
    destAction: THREE.AnimationAction | undefined,
    duration: number,
  ) {
    let previousAction = this._currentAction;
    this._currentAction = destAction;

    if (previousAction !== this._currentAction) {
      previousAction?.fadeOut(duration);
    }

    this._currentAction
      ?.reset()
      .setEffectiveTimeScale(1)
      .setEffectiveWeight(1)
      .fadeIn(0.5)
      .play();
  }

  private async modifyAnimationPosition(
    clip: THREE.AnimationClip,
    weight: { [key: string]: number },
  ) {
    const { vrm } = this;
    if (vrm == null) {
      throw new Error("You have to load VRM first");
    }

    // Find the hips bone
    const hipsBone = vrm.humanoid.getNormalizedBoneNode("hips");

    if (!hipsBone) {
      throw new Error("Bone not found in VRM model");
    }

    // Use the current hips bone position as the start position
    const currentHipsPosition = hipsBone!.getWorldPosition(new THREE.Vector3());

    // Extract the start position from the animation clip
    let clipStartPositionHips: THREE.Vector3 | null = null;

    for (const track of clip.tracks) {
      if (track.name.endsWith(".position") && track.name.includes("Hips")) {
        const values = (track as THREE.VectorKeyframeTrack).values;
        clipStartPositionHips = new THREE.Vector3(
          values[0],
          values[1],
          values[2],
        );
        break;
      }
    }

    if (clipStartPositionHips) {
      // Calculate the offset
      const offsetHipsPosition = currentHipsPosition
        .clone()
        .sub(clipStartPositionHips);

      // Apply the offset to all keyframes
      for (const track of clip.tracks) {
        if (track.name.endsWith(".position") && track.name.includes("Hips")) {
          const values = (track as THREE.VectorKeyframeTrack).values;
          for (let i = 0; i < values.length; i += 3) {
            values[i] -= offsetHipsPosition.x / weight.x;
            values[i + 1] += offsetHipsPosition.y * weight.y;
            values[i + 2] += offsetHipsPosition.z * weight.z;
          }
        }
      }
    } else {
      console.warn("Could not determine start position from animation clip.");
    }
  }

  public async playAnimation(
    animation: VRMAnimation | THREE.AnimationClip,
    name: string,
  ): Promise<number> {
    const { vrm, mixer } = this;
    if (vrm == null || mixer == null) {
      throw new Error("You have to load VRM first");
    }

    const clip =
      animation instanceof THREE.AnimationClip
        ? animation
        : animation.createAnimationClip(vrm);

    // modify the initial position of the VRMA animation to be sync with idle animation
    let weight: { [key: string]: number } = { x: 1, y: 1, z: 1 };

    if (!(name === "idle_loop.vrma" || name === "greeting.vrma")) {
      if (name === "dance.vrma") {
        weight = { x: 2, y: 1.25, z: 1.5 };
      } else {
        weight = { x: 1, y: 1, z: 0 };
      }
      this.modifyAnimationPosition(clip, weight);
    }

    const idleAction = this._currentAction;
    const VRMAaction = mixer.clipAction(clip);
    VRMAaction.clampWhenFinished = true;
    VRMAaction.loop = THREE.LoopOnce;
    this.fadeToAction(VRMAaction, 1);

    const restoreState = () => {
      mixer.removeEventListener("finished", restoreState);
      this.fadeToAction(idleAction, 1);
    };

    mixer.addEventListener("finished", restoreState);
    return clip.duration + 1 + 0.5; // 1 = fade out time, 0.5 = fade in time
  }

  public async playEmotion(expression: string) {
    this.emoteController?.playEmotion(expression);
    // The body idles in the same mood as the face — see emotionMood.ts.
    this.proceduralAnimation?.setEmotion(expression);
  }

  /**
   * PLAY AN EMOTE — the named gesture the stage never had.
   *
   * `playEmotion` above can put a mood on her face and colour the idle with it, and that is all it
   * can do: one expression, one weight, no body. An emote is the deliberate version — several
   * expressions held together (a wink is an eyelid AND half a smile), optionally over a slice of an
   * authored clip, for a fixed beat, and then everything handed back. See features/emote/emotes.ts.
   *
   * IT DEGRADES IN BOTH DIRECTIONS, because a visitor can swap the model out from under it:
   *   - no expression of the emote's exists on this VRM ⇒ fall back to the emote's mood, which is
   *     an ordinary emotion tag and works on any model;
   *   - the clip 404s, or slices to nothing ⇒ the face half still plays. An emote is never a throw
   *     on the stage.
   */
  public async playEmote(emote: Emote): Promise<void> {
    const face = resolveFace(emote, this.emoteController?.availableExpressions);
    if (Object.keys(face).length > 0) {
      this.emoteController?.playEmoteFace(face, emote.holdSeconds);
    } else {
      this.emoteController?.playEmotion(emote.mood);
    }

    // The body idles in the emote's temperament for as long as the emote lasts, then goes back to
    // whatever emotion her face is actually wearing (update() below owns that clock).
    this.proceduralAnimation?.setEmotion(emote.mood);
    this._emoteMoodLeft = Math.max(emote.holdSeconds, 0);

    if (emote.gesture) {
      await this.playGesture(emote.gesture, emote.id);
    } else {
      this.stopGesture();
    }
  }

  /**
   * The BODY half: a window of one bundled `.vrma`, cross-faded in over the idle and out again.
   *
   * Two things make this different from `playAnimation` below, and both are the reason emotes could
   * not be built on it. It does not need an idle ACTION to return to — with the statistical idle on
   * (the default) the mixer holds no idle action at all, so `playAnimation`'s `this._currentAction!`
   * is `undefined` and its restore throws. And it tells the procedural idle to stand aside for the
   * duration (`setGestureWeight`), without which the idle rewrites the shoulder every frame and the
   * gesture comes out as a bent elbow on a lowered arm.
   *
   * Returns the seconds the gesture will occupy, 0 when nothing could be played.
   */
  public async playGesture(gesture: GestureClip, name: string): Promise<number> {
    const { vrm, mixer } = this;
    if (vrm == null || mixer == null) return 0;

    let clip: THREE.AnimationClip | null = null;
    try {
      const animation = await loadVRMAnimation(`/animations/${gesture.file}`);
      if (animation) clip = buildGestureClip(animation, vrm, gesture, `emote:${name}`);
    } catch {
      // A missing or unreadable clip is a gesture that does not happen, never a dead render loop.
      return 0;
    }
    if (!clip) return 0;

    // The VRM may have been swapped while the clip was loading.
    if (this.vrm !== vrm || this.mixer !== mixer) return 0;

    this.stopGesture();

    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(Model.GESTURE_FADE_S).play();

    this._gesture = { action, fadeLeft: 0 };
    this.proceduralAnimation?.setGestureWeight(1);

    const onFinished = (event: { action?: THREE.AnimationAction }) => {
      if (event.action !== action) return;
      mixer.removeEventListener("finished", onFinished as never);
      if (this._gesture?.action !== action) return;
      // Hand the rig back: the action fades toward the pose the mixer saved when it was activated,
      // and the idle fades back in over it.
      action.fadeOut(Model.GESTURE_FADE_S);
      this._gesture.fadeLeft = Model.GESTURE_FADE_S;
      this.proceduralAnimation?.setGestureWeight(0);
    };
    mixer.addEventListener("finished", onFinished as never);

    return clip.duration + Model.GESTURE_FADE_S;
  }

  /** Cut a running gesture immediately — a new emote, or a model unload. Safe when none is running. */
  public stopGesture(): void {
    const running = this._gesture;
    this._gesture = undefined;
    this.proceduralAnimation?.setGestureWeight(0);
    if (!running) return;
    running.action.stop();
    this.mixer?.uncacheAction(running.action.getClip());
  }

  /**
   * 音声を再生し、リップシンクを行う
   */
  public async speak(buffer: ArrayBuffer, screenplay: Screenplay) {
    this.emoteController?.playEmotion(screenplay.expression);
    this.proceduralAnimation?.setEmotion(screenplay.expression);
    /*
     * SHE ASKED FOR A GESTURE ON THIS LINE. After the emotion, deliberately: playEmote borrows the
     * face from whatever emotion is on it, so the emotion has to be set first or the emote restores
     * the previous one when it lets go. Not awaited — it loads a clip over the network, and the
     * audio must not wait on that; a failure inside it is already contained (see playEmote).
     */
    if (screenplay.emote) {
      const emote = EMOTES[screenplay.emote];
      if (emote) void this.playEmote(emote).catch(() => { /* an emote never breaks a line */ });
    }
    await new Promise((resolve) => {
      this._lipSync?.playFromArrayBuffer(buffer, () => {
        resolve(true);
      });
    });
  }

  public update(delta: number): void {
    /*
     * IS SHE SPEAKING RIGHT NOW? Derived from the mouth audio this block already computes, rather
     * than from a flag set somewhere else: the puppeteering driver hands the mouth back to the
     * lip-sync while she talks, and the only signal that is never wrong about that is the audio
     * that is actually driving the mouth on this frame.
     */
    let speaking = false;
    if (this._lipSync) {
      // Viseme mouth when airi's wLipSync worklet is running; the original volume mouth when it
      // is not (insecure context, no AudioWorklet). Both paths are decided per frame, so a
      // worklet that dies mid-show degrades gracefully instead of freezing the mouth.
      const vowels = this._lipSync.vowelFrame(delta);
      if (vowels) {
        this.emoteController?.lipSyncVisemes(vowels);
        speaking = true;
      } else {
        const { volume } = this._lipSync.update();
        this.emoteController?.lipSync("aa", volume);
        // A small floor, not `> 0`: an idle analyser floats on noise, and a mouth that is "speaking"
        // at 0.001 would keep the operator's jaw locked out for the whole show.
        speaking = volume > 0.02;
      }
    }

    /*
     * The operator's face, BEFORE vrm.update — so the expression values reach the mesh on this
     * frame rather than one behind. It writes only what nothing else owns (eyes, brows, and the
     * mouth while she is silent); see faceDriver.ts for why each of those is safe to take.
     */
    if (this.vrm && this._faceDriver) {
      this._faceDriver.applyExpressions(this.vrm, this._faceTracker?.latest() ?? null, delta, speaking);
    }

    this.emoteController?.update(delta);
    this.mixer?.update(delta);
    this.vrm?.update(delta);
    // AIRI statistical idle. When on (default), viewer.ts does NOT load/play the looping idle_loop.vrma,
    // so mixer.update above drives no idle action and the procedural pass is authoritative over the
    // bones — the two never double-drive. statisticalIdle.update never throws (falls back to the
    // authored idle), so leaving it in the render loop is safe.
    if (config("animation_procedural") === "true") {
      this.proceduralAnimation?.update(delta);
    }

    /*
     * THE EMOTE'S CLOCKS, both on the render loop for the reason given on `_gesture`.
     *
     * The gesture's fade-out is finished here rather than by the timer that started it, and the
     * borrowed idle temperament is returned to whatever emotion her face is actually wearing —
     * NOT to neutral, which would wipe a mood the chat set while the emote was playing.
     */
    if (this._gesture && this._gesture.fadeLeft > 0) {
      this._gesture.fadeLeft -= Number.isFinite(delta) && delta > 0 ? delta : 0;
      if (this._gesture.fadeLeft <= 0) this.stopGesture();
    }
    if (this._emoteMoodLeft > 0) {
      this._emoteMoodLeft -= Number.isFinite(delta) && delta > 0 ? delta : 0;
      if (this._emoteMoodLeft <= 0) {
        this.proceduralAnimation?.setEmotion(this.emoteController?.currentEmotion ?? "neutral");
      }
    }

    /*
     * The head, AFTER the idle. Both write the same bone, and while an operator is driving, the
     * operator's value is the head — so this runs last and wins, rather than adding to a pose the
     * idle already moved and drifting further off centre the longer the show runs.
     */
    if (this.vrm && this._faceDriver) {
      this._faceDriver.applyHead(this.vrm, this._faceTracker?.latest() ?? null, delta);
    }
  }

  /**
   * Start driving her face from `video` (the operator's camera).
   *
   * Returns false when the tracker could not start — a refused camera, a WASM 404, a model
   * download that failed — with the reason on `faceTrackingError()`. It never throws: this is
   * called from a UI toggle, and a rejection there would take out the stage.
   */
  public async startFaceTracking(video: HTMLVideoElement): Promise<boolean> {
    if (!this._faceTracker) this._faceTracker = createFaceTracker();
    if (!this._faceDriver) this._faceDriver = createFaceDriver();
    this._faceDriver.reset();
    return this._faceTracker.start(video);
  }

  /** Stop driving her face. The driver eases her back to neutral over the next few frames. */
  public stopFaceTracking(): void {
    this._faceTracker?.stop();
    this._faceDriver?.reset();
  }

  public isFaceTracking(): boolean {
    return this._faceTracker?.running() ?? false;
  }

  public faceTrackingError(): string {
    return this._faceTracker?.lastError() ?? '';
  }
}
