import {
  createPlaybackManager,
  createSpeechPipeline,
} from "@/airi/pipelines-audio";
import { Screenplay, Talk, textsToScreenplay } from "./messages";

/**
 * streamingSpeech.ts — wire AIRI's streaming-TTS pipeline into amica's avatar speech, behind a flag.
 *
 * amica's default path (chat.ts ttsJobs → speakJobs) generates and speaks sentences one at a time:
 * sentence N+1's audio is not requested until N has been spoken. AIRI's pipeline
 * (src/airi/pipelines-audio, MIT, ported) generates TTS for up to `ttsMaxConcurrent` sentences at
 * once while playing them back in strict order — so the gap between sentences shrinks to the TTS
 * latency of ONE sentence, not the sum. It also owns barge-in (an intent opened with
 * `behavior:'replace'` cancels the previous turn's queued+playing audio).
 *
 * WHAT THIS REUSES (deliberately): amica's own parsing. `chat.ts` still runs `processResponse`, which
 * splits sentences and strips <think>/roleplay and parses the inline `[emotion]` tag into a
 * `Screenplay`. We feed each already-parsed sentence back in as `[emotion] cleanText`, so both the
 * `tts` and `play` callbacks re-derive the same Screenplay via `textsToScreenplay` — one code path
 * for emotion→VRM, no second emotion vocabulary. The pipeline adds concurrency + ordering + interrupt,
 * nothing about the persona or the voice.
 *
 * TAudio = ArrayBuffer (what fetchAudio returns and model.speak consumes). Everything above the two
 * host callbacks is pure/mockable (the pipeline ships its own tests); only `tts` and `play` touch the
 * avatar, and both fail safe (a null audio buffer is simply not played).
 */

export interface StreamingSpeechDeps {
  /** amica's Chat.fetchAudio — text → audio for the configured TTS backend, or null. */
  fetchAudio: (talk: Talk) => Promise<ArrayBuffer | null>;
  /** Viewer.model.speak — play audio on the avatar with the screenplay's expression + lip-sync. */
  speak: (audio: ArrayBuffer, screenplay: Screenplay) => Promise<void>;
  /** Push the spoken line into the transcript / conversation (amica's bubbleMessage). */
  bubble?: (text: string) => void;
  onSpeakStart?: () => void;
  onSpeakEnd?: () => void;
}

/** A single assistant turn: feed parsed sentences in order, then end() to flush the last one. */
export interface StreamingTurn {
  feed: (screenplay: Screenplay) => void;
  end: () => void;
}

export interface StreamingSpeech {
  openTurn: () => StreamingTurn;
  interrupt: () => void;
}

/** Re-encode a parsed sentence so a callback can re-derive its Screenplay from the segment text. */
function encode(screenplay: Screenplay): string {
  const tag = screenplay.expression ? `[${screenplay.expression}] ` : "";
  return tag + (screenplay.talk?.message ?? screenplay.text ?? "");
}

export function createStreamingSpeech(deps: StreamingSpeechDeps): StreamingSpeech {
  const playback = createPlaybackManager<ArrayBuffer>({
    maxVoices: 1, // amica speaks with one voice at a time
    play: async (item) => {
      if (item.audio == null || !item.text) return;
      const [sp] = textsToScreenplay([item.text]);
      if (!sp) return;
      deps.bubble?.(sp.text);
      deps.onSpeakStart?.();
      try {
        await deps.speak(item.audio, sp);
      } catch (e) {
        /*
         * ONE SENTENCE FAILING TO PLAY MUST NOT END THE TURN.
         *
         * This path is now the DEFAULT speech path, not an opt-in experiment, and the playback
         * manager plays in strict order — so a rejection here does not lose one line, it stalls
         * every line queued behind it and she goes silent mid-answer with no error anyone sees.
         * `model.speak` reaches into the VRM's audio graph and the browser's autoplay policy;
         * both throw for reasons that have nothing to do with the next sentence.
         *
         * The text was already bubbled above, so a failure degrades to "she typed it but did not
         * say it" — which is the same shape amica's non-streaming path degrades to when TTS is off.
         */
        console.warn('[streamingSpeech] a sentence could not be spoken; continuing the turn', e);
      } finally {
        deps.onSpeakEnd?.();
      }
    },
  });

  const pipeline = createSpeechPipeline<ArrayBuffer>({
    ttsMaxConcurrent: 4,
    playback,
    tts: async (request) => {
      if (!request.text) return null;
      const [sp] = textsToScreenplay([request.text]);
      if (!sp) return null;
      try {
        return await deps.fetchAudio(sp.talk);
      } catch (e) {
        /*
         * A TTS FAILURE IS A SILENT SENTENCE, NEVER A BROKEN TURN.
         *
         * `Chat.fetchAudio` catches its own backend errors and returns null, but it is not the
         * only thing that can reject here: an aborted fetch, a proxy that closes the connection,
         * an RVC pass that throws. `null` is the pipeline's documented "nothing to play", and the
         * playback manager skips it — so the rest of the answer still gets spoken instead of the
         * whole turn dying on one bad sentence.
         */
        console.warn('[streamingSpeech] TTS failed for a sentence; it will not be spoken', e);
        return null;
      }
    },
  });

  return {
    openTurn(): StreamingTurn {
      // `replace` == this turn cancels the previous turn's queued and playing audio (barge-in).
      const intent = pipeline.openIntent({ behavior: "replace" });
      return {
        feed(screenplay: Screenplay) {
          intent.writeLiteral(encode(screenplay));
          intent.writeFlush(); // one sentence per segment; we pre-split via processResponse
        },
        end() {
          intent.end();
        },
      };
    },
    interrupt() {
      pipeline.stopAll("interrupt");
    },
  };
}
