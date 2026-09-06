import { Message } from "./messages";

/**
 * preflightChat — the honest, keyless chat state before the Claude bridge is live.
 *
 * $NPC's real conversation runs through the bridge (NEXT_PUBLIC_NPC_API) into Claude. Until that
 * origin is configured, we do NOT silently fall back to echo (which parrots the user and reads as
 * broken) or to a third-party demo endpoint (which would be dishonest about whose brain is talking).
 * Instead she says, in character, that she is not fully awake yet — the avatar still speaks and
 * lip-syncs, so the stage stays alive rather than dead. This is the "opens at launch" degrade.
 */
const LINES = [
  "i'm awake enough to stand here, but my full voice opens at launch.",
  "the bridge to my real brain isn't live yet — come back when i can actually talk.",
  "i can see you. i just can't answer properly until launch. soon.",
];

export async function getPreflightChatResponseStream(_messages: Message[]) {
  const line = LINES[Math.floor(Math.random() * LINES.length)];

  return new ReadableStream({
    async start(controller: ReadableStreamDefaultController) {
      try {
        line
          .split(" ")
          .map((word) => word + " ")
          .forEach((word) => controller.enqueue(word));
      } catch (error) {
        controller.error(error);
      } finally {
        controller.close();
      }
    },
  });
}
