import { LipSyncAnalyzeResult } from "./lipSyncAnalyzeResult";

import {
  createWLipSyncVowelDriver,
  wlipsyncProfile,
  type WLipSyncVowelWeights,
} from "@/airi/lipsync/shared/wlipsync";
import type { Profile, WLipSyncAudioNode } from "wlipsync";

const TIME_DOMAIN_DATA_LENGTH = 2048;

/**
 * Audio playback + mouth analysis for the VRM stage.
 *
 * Two analysers run side by side over the SAME buffer source:
 *
 *   - the original volume analyser (time-domain max → sigmoid), kept verbatim as the fallback
 *     and as the coarse "is she speaking" signal;
 *   - airi's wLipSync worklet (merged via src/airi/lipsync): MFCC viseme classification into
 *     A/E/I/O/U/S weights, smoothed into stable vowel weights by the shared vowel driver, which
 *     the expression controller maps onto the VRM's aa/ee/ih/oh/ou mouth presets.
 *
 * The worklet is genuinely optional. It needs AudioWorklet + WebAssembly + a secure context, and
 * a stage that cannot have it must speak exactly as it always did — so `vowelFrame()` is null
 * until the node exists and null again if it ever fails, and the caller falls back to the volume
 * path. Nothing here throws into the render loop.
 */
export class LipSync {
  public readonly audio: AudioContext;
  public readonly analyser: AnalyserNode;
  public readonly timeDomainData: Float32Array;

  private wlipsync: WLipSyncAudioNode | null = null;
  private readonly vowelDriver = createWLipSyncVowelDriver();
  /** Kicked off once in the constructor; settled (or given up) before most first speech. */
  private wlipsyncReady: Promise<void>;

  public constructor(audio: AudioContext) {
    this.audio = audio;

    this.analyser = audio.createAnalyser();
    this.timeDomainData = new Float32Array(TIME_DOMAIN_DATA_LENGTH);

    // wlipsync references AudioWorkletNode AT MODULE SCOPE, so it can only ever be imported in a
    // browser — a static import crashes Next's server-side page-data collection outright. Hence
    // the dynamic import behind a capability check, and the `as unknown as Profile` because the
    // calibrated profile ships as JSON whose inferred type is structurally wider than Profile.
    this.wlipsyncReady = (async () => {
      if (typeof AudioWorkletNode === "undefined" || typeof WebAssembly === "undefined") return;
      const { createWLipSyncNode } = await import("@/airi/lipsync/runtime/wlipsync");
      this.wlipsync = await createWLipSyncNode(audio, wlipsyncProfile as unknown as Profile);
    })().catch((e: unknown) => {
      // No AudioWorklet / insecure context / wasm refused: the volume path still works, and this
      // is the one place that says why the mouth is coarse rather than failing silently forever.
      console.warn("[lipsync] viseme analysis unavailable, using volume-only mouth:", e instanceof Error ? e.message : e);
      this.wlipsync = null;
    });
  }

  public update(): LipSyncAnalyzeResult {
    this.analyser.getFloatTimeDomainData(this.timeDomainData);

    let volume = 0.0;
    for (let i = 0; i < TIME_DOMAIN_DATA_LENGTH; i++) {
      volume = Math.max(volume, Math.abs(this.timeDomainData[i]));
    }

    // cook
    volume = 1 / (1 + Math.exp(-45 * volume + 5));
    if (volume < 0.1) volume = 0;

    return {
      volume,
    };
  }

  /**
   * The smoothed per-vowel mouth weights for this frame, or null when viseme analysis is not
   * running (worklet unavailable) — the caller then uses `update().volume` exactly as before.
   */
  public vowelFrame(deltaSeconds?: number): WLipSyncVowelWeights | null {
    const node = this.wlipsync;
    if (!node) return null;
    try {
      return this.vowelDriver.update({ volume: node.volume, weights: node.weights }, deltaSeconds);
    } catch {
      // A driver that starts throwing mid-show is retired for the session; volume mouth continues.
      this.wlipsync = null;
      return null;
    }
  }

  public async playFromArrayBuffer(buffer: ArrayBuffer, onEnded?: () => void) {
    // If the worklet is still initializing on the very first line she speaks, give it the chance
    // to catch that line too; a failed init settled this promise already and costs nothing.
    await this.wlipsyncReady;

    const audioBuffer = await this.audio.decodeAudioData(buffer);

    const bufferSource = this.audio.createBufferSource();
    bufferSource.buffer = audioBuffer;

    bufferSource.connect(this.audio.destination);
    bufferSource.connect(this.analyser);
    // The wLipSync node produces no audio output; it only reads. Connecting it never doubles sound.
    if (this.wlipsync) {
      try {
        bufferSource.connect(this.wlipsync);
      } catch {
        this.wlipsync = null; // a dead node must not take playback down with it
      }
    }
    this.vowelDriver.reset();
    bufferSource.start();
    if (onEnded) {
      bufferSource.addEventListener("ended", onEnded);
    }
  }

  public async playFromURL(url: string, onEnded?: () => void) {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    this.playFromArrayBuffer(buffer, onEnded);
  }
}
