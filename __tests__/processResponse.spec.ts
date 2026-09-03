import { describe, expect, test } from "@jest/globals";
import { Screenplay } from "../src/features/chat/messages";
import { processResponse } from "../src/utils/processResponse";

/*
 * WHY THIS FILE IS WRITTEN AGAINST THE FULL SEVEN-FIELD CONTRACT.
 *
 * This spec is upstream amica scaffolding and it froze at the five-field version of
 * `processResponse`. The function has since grown two more threaded fields — `isThinking` and
 * `rolePlay` — because a streaming reply arrives in fragments: the `<think>` / `</think>` markers
 * and the `*action*` roleplay span can straddle a chunk boundary, so their state has to be carried
 * OUT of one call and back IN to the next (src/utils/processResponse.ts:36-58). The old call site
 * passed neither, and `tsc --noEmit` failed on it with TS2345.
 *
 * That single error is why the front-end CI gate had never once gone green — the typecheck step
 * exits non-zero, so the `next build` step below it never ran, and the gate that exists to stop a
 * syntax error shipping to /game, /holder and /trust was protecting nothing.
 *
 * The fix belongs in the TEST, not in a tsconfig `exclude`: excluding `__tests__/` would take the
 * file back out of the program and re-hide exactly this class of drift. So the spec now passes both
 * fields and, more importantly, ASSERTS what the thinking/roleplay stripping does with them —
 * otherwise they would be two values threaded through with nothing checking them.
 */
describe("Process Response Tests", () => {
  test("empty input is a no-op and threads isThinking/rolePlay straight back out", () => {
    const sentences: string[] = [];
    const aiTextLog = "";
    const receivedMessage = "";
    const tag = "";

    let cbTriggered = false;

    const proc = processResponse({
      sentences,
      aiTextLog,
      receivedMessage,
      tag,
      isThinking: false,
      rolePlay: "",
      callback: (aiTalks: Screenplay[]) => {
        cbTriggered = true;
        expect(aiTalks).toEqual([]);
        return false;
      },
    });
    expect(proc.sentences).toStrictEqual([]);
    expect(proc.aiTextLog).toBe("");
    expect(proc.receivedMessage).toBe("");
    expect(proc.tag).toBe("");
    // Nothing in the buffer means nothing to decide: both carried fields come back untouched.
    expect(proc.isThinking).toBe(false);
    expect(proc.rolePlay).toBe("");
    expect(proc.shouldBreak).toBe(false);
    expect(cbTriggered).toBe(false);
  });

  test("an opening <think> flips isThinking on and is consumed from the buffer", () => {
    const proc = processResponse({
      sentences: [],
      aiTextLog: "",
      receivedMessage: "<think>",
      tag: "",
      isThinking: false,
      rolePlay: "",
      callback: () => false,
    });

    // The marker itself must never reach the TTS queue, and the caller's next chunk has to know it
    // is inside a reasoning block — that is the entire reason isThinking is returned rather than
    // recomputed from the fragment in hand.
    expect(proc.isThinking).toBe(true);
    expect(proc.receivedMessage).toBe("");
    expect(proc.sentences).toStrictEqual([]);
  });

  test("</think>, an emotion tag and a *roleplay* span are all stripped before the spoken sentence", () => {
    const spoken: Screenplay[][] = [];

    const proc = processResponse({
      sentences: [],
      aiTextLog: "",
      receivedMessage: "</think>[happy]*smiles softly*Hello there.",
      tag: "",
      // The previous chunk left us inside a reasoning block; the closing marker in THIS chunk is
      // what ends it. Recomputing from the fragment alone could not know that.
      isThinking: true,
      rolePlay: "",
      callback: (aiTalks: Screenplay[]) => {
        spoken.push(aiTalks);
        return false;
      },
    });

    expect(proc.isThinking).toBe(false);
    expect(proc.rolePlay).toBe("*smiles softly*");
    expect(proc.tag).toBe("[happy]");
    expect(proc.sentences).toStrictEqual(["Hello there."]);
    expect(proc.receivedMessage).toBe("");
    expect(proc.aiTextLog).toBe("[happy] Hello there.");
    expect(proc.shouldBreak).toBe(false);

    // The roleplay span is stripped from what is SPOKEN — "*smiles softly*" read aloud is the bug
    // this branch exists to prevent — while the tag survives as the expression.
    expect(spoken).toHaveLength(1);
    // The leading space is real: `aiText` is built as `${tag} ${sentence}` and textsToScreenplay
    // deletes only the bracketed tag, not the separator it was joined with.
    expect(spoken[0][0].talk.message).toBe(" Hello there.");
    expect(spoken[0][0].expression).toBe("happy");
  });
});
