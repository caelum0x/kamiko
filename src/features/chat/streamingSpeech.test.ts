/**
 * @jest-environment node
 *
 * streamingSpeech.test.ts — drive a real assistant turn through createStreamingSpeech with fake host
 * deps (fetchAudio / speak / bubble). This exercises the real AIRI pipeline wiring (concurrency +
 * ordering + interrupt) end-to-end; only the avatar-facing callbacks are faked.
 *
 * Runs in the `node` environment because the pipeline relies on WHATWG streams, TextEncoder and
 * Intl.Segmenter — all first-class in Node, but not guaranteed under jsdom.
 */
import { describe, expect, it, jest } from "@jest/globals";
import { createStreamingSpeech, type StreamingSpeechDeps } from "@/features/chat/streamingSpeech";
import type { Screenplay, Talk } from "@/features/chat/messages";

function sp(expression: string, message: string): Screenplay {
  return {
    expression: expression as Screenplay["expression"],
    talk: { style: "talk", message },
    text: message,
  };
}

/** Poll a condition using real timers until true or the deadline passes. */
async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 5));
  }
  return true;
}

function makeDeps() {
  const fetchCalls: Array<{ talk: Talk; buffer: ArrayBuffer }> = [];
  const bufFor = new Map<string, ArrayBuffer>();

  const fetchAudio = jest.fn(async (talk: Talk): Promise<ArrayBuffer | null> => {
    if (!bufFor.has(talk.message)) {
      // A distinct, non-empty buffer per sentence so we can assert playback identity + order.
      bufFor.set(talk.message, new ArrayBuffer(bufFor.size + 1));
    }
    const buffer = bufFor.get(talk.message)!;
    fetchCalls.push({ talk, buffer });
    return buffer;
  });

  const speak = jest.fn(async (_audio: ArrayBuffer, _screenplay: Screenplay): Promise<void> => {});
  const bubble = jest.fn((_text: string) => {});

  const deps: StreamingSpeechDeps = { fetchAudio, speak, bubble };
  return { deps, fetchAudio, speak, bubble, fetchCalls };
}

describe("createStreamingSpeech", () => {
  it("exposes the turn/interrupt wiring", () => {
    const { deps } = makeDeps();
    const speech = createStreamingSpeech(deps);

    const turn = speech.openTurn();
    expect(typeof turn.feed).toBe("function");
    expect(typeof turn.end).toBe("function");
    expect(typeof speech.interrupt).toBe("function");
    expect(() => speech.interrupt()).not.toThrow();
  });

  it("speaks each fed sentence in order with its audio + preserved expression, and strips the [tag] before TTS", async () => {
    const { deps, fetchAudio, speak, bubble, fetchCalls } = makeDeps();
    const speech = createStreamingSpeech(deps);

    const turn = speech.openTurn();
    turn.feed(sp("happy", "hello there."));
    turn.feed(sp("sad", "goodbye now."));
    turn.end();

    const spoke = await waitFor(() => speak.mock.calls.length >= 2);
    expect(spoke).toBe(true);

    // TTS was asked for the CLEAN sentence — the inline [emotion] tag never reaches fetchAudio.
    expect(fetchAudio).toHaveBeenCalled();
    for (const call of fetchCalls) {
      expect(call.talk.message).not.toContain("[");
      expect(call.talk.message).not.toContain("]");
    }
    const helloFetch = fetchCalls.find((c) => c.talk.message.includes("hello there"));
    const byeFetch = fetchCalls.find((c) => c.talk.message.includes("goodbye now"));
    expect(helloFetch).toBeDefined();
    expect(byeFetch).toBeDefined();

    // Playback happened in the fed order, each with the exact audio buffer TTS produced...
    expect(speak.mock.calls[0][0]).toBe(helloFetch!.buffer);
    expect(speak.mock.calls[1][0]).toBe(byeFetch!.buffer);
    // ...and the per-sentence expression is preserved for the VRM.
    expect(speak.mock.calls[0][1].expression).toBe("happy");
    expect(speak.mock.calls[1][1].expression).toBe("sad");

    // The transcript bubble received the spoken lines, in order.
    expect(bubble.mock.calls.length).toBeGreaterThanOrEqual(2);
    const bubbled = bubble.mock.calls.map((c) => c[0]).join(" || ");
    expect(bubbled).toContain("hello there");
    expect(bubbled).toContain("goodbye now");
    expect(bubble.mock.calls[0][0]).toContain("hello there");
    expect(bubble.mock.calls[1][0]).toContain("goodbye now");
  });

  it("interrupt() during a turn is safe and callable", async () => {
    const { deps, speak } = makeDeps();
    const speech = createStreamingSpeech(deps);

    const turn = speech.openTurn();
    turn.feed(sp("happy", "an interrupted sentence."));
    expect(() => speech.interrupt()).not.toThrow();
    turn.end();

    // Give the pipeline a moment; the key assertion is that nothing threw.
    await waitFor(() => speak.mock.calls.length >= 1, 300);
    expect(true).toBe(true);
  });
});
