import { config } from '@/utils/config';
import { toVrmFacePose, type VrmFacePose } from './arkitToVrm';

/**
 * faceTracker.ts — the camera half of operator puppeteering.
 *
 * WHAT THIS IS FOR. She is an AI VTuber with her own brain, and this is the switch that lets a
 * human take her face for a live show: the operator's head, eyes, brows and jaw drive the avatar
 * while the AI keeps her voice. It is the one feature in this product where the person behind the
 * camera is the character, and it is off by default because most of the time she is not.
 *
 * EVERYTHING HERE IS LAZY. `@mediapipe/tasks-vision` and its WASM are several megabytes, and the
 * face model is another few from Google's CDN. A visitor who never turns puppeteering on must not
 * pay for any of it, so the import is dynamic and nothing is fetched until `start()` is called. On
 * a stage that already loads a VRM and an ONNX runtime, one more eager dependency is the
 * difference between a slow first paint and a broken one.
 *
 * IT NEVER THROWS AT THE CALLER. A camera that is refused, a WASM file that 404s, a model download
 * that fails, a GPU delegate that is unavailable — every one of them ends as `start()` returning
 * false with a reason on `lastError`, because the alternative is an unhandled rejection taking down
 * the render loop of the thing the product IS. The avatar keeps working; puppeteering just does
 * not come on.
 */

/** Where the tracker loads its WASM from. Copied into public/ by next.config.js at build time. */
const WASM_BASE = '/mediapipe/wasm';

/**
 * The face model.
 *
 * Google's CDN by default because it is ~3.7 MB of binary that would otherwise be committed to
 * this repository forever, and it is only fetched by the operator who turns tracking on — never by
 * a visitor. `NEXT_PUBLIC_FACE_MODEL_URL` points it at a self-hosted copy for a deployment that
 * will not depend on a third party for a feature it runs a show on.
 */
const DEFAULT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export interface FaceTracker {
  /** Begin tracking `video`. Resolves false when it could not start; see `lastError()`. */
  start(video: HTMLVideoElement): Promise<boolean>;
  /** Stop tracking and release the model. Safe to call when not running. */
  stop(): void;
  /** True between a successful start() and a stop(). */
  running(): boolean;
  /**
   * The most recent pose, or null when nothing has been tracked yet.
   *
   * PULLED BY THE RENDER LOOP, NOT PUSHED. The camera runs at ~30fps and the renderer at 60–144;
   * a push would either drop frames or queue them, and the render loop only ever wants the latest.
   */
  latest(): VrmFacePose | null;
  /** Why the last start() failed, for an operator who needs to know which of five things it was. */
  lastError(): string;
}

export function createFaceTracker(): FaceTracker {
  /** Typed loosely on purpose: the SDK's own types come with the dynamic import, not before it. */
  let landmarker: { detectForVideo: (v: HTMLVideoElement, t: number) => unknown; close: () => void } | null = null;
  let raf = 0;
  let pose: VrmFacePose | null = null;
  let error = '';
  let starting = false;

  const detectLoop = (video: HTMLVideoElement) => {
    raf = requestAnimationFrame(() => detectLoop(video));
    if (!landmarker) return;
    // A video element that is not producing frames yet returns the SAME timestamp, and MediaPipe
    // throws on a non-monotonic one. readyState >= 2 is "has current frame data".
    if (video.readyState < 2 || video.videoWidth === 0) return;
    try {
      const res = landmarker.detectForVideo(video, performance.now()) as {
        faceBlendshapes?: Array<{ categories?: Array<{ categoryName?: string; score?: number }> }>;
        facialTransformationMatrixes?: Array<{ data?: number[] }>;
      };
      pose = toVrmFacePose(res?.faceBlendshapes?.[0]?.categories, res?.facialTransformationMatrixes?.[0]?.data);
    } catch {
      /*
       * A DROPPED FRAME IS NOT AN OUTAGE. detectForVideo throws on a duplicate timestamp, a resized
       * texture, or a GPU context loss — all transient, all recoverable on the next frame. The last
       * good pose stays applied, which reads as the operator holding still rather than as the
       * avatar's face collapsing.
       */
    }
  };

  return {
    async start(video) {
      if (landmarker || starting) return true;
      starting = true;
      error = '';
      try {
        // Dynamic: this is where the megabytes are, and they are only spent by an operator who
        // asked for them.
        const vision = await import('@mediapipe/tasks-vision');
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
        const modelUrl = config('face_model_url') || DEFAULT_MODEL_URL;
        landmarker = (await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: modelUrl,
            // GPU where the browser allows it; the SDK falls back to CPU on its own, and a CPU
            // fallback at 30fps is still a working face.
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          // The two outputs this feature is built on. Without blendshapes there is no face; without
          // the transformation matrix there is no head rotation, only expressions.
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        })) as unknown as typeof landmarker;
        detectLoop(video);
        return true;
      } catch (e) {
        // Named precisely, because the five ways this fails need five different fixes and an
        // operator mid-show has no time to guess which one they are looking at.
        error = e instanceof Error ? e.message : String(e);
        landmarker = null;
        return false;
      } finally {
        starting = false;
      }
    },

    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      try {
        landmarker?.close();
      } catch {
        // The SDK throws if the WASM heap is already gone (a hot reload, a closed tab). Nothing to
        // recover — we are discarding it either way.
      }
      landmarker = null;
      // Cleared so the driver eases the avatar's face back to neutral instead of freezing it on
      // whatever the operator's last expression happened to be.
      pose = null;
    },

    running: () => landmarker !== null,
    latest: () => pose,
    lastError: () => error,
  };
}
