import { Message } from "./messages";

/**
 * preflightChat — same-origin chat bridge with an honest keyless fallback.
 *
 * Order of operations (the caller is unchanged — this still resolves to a word-by-word
 * ReadableStream the chat pipeline reads token by token):
 *   1. POST the conversation to same-origin `/api/chat` as `{ messages: {role, content}[] }`.
 *   2. HTTP 200 -> stream the assistant reply back word-by-word (LIVE chat). We accept either a JSON
 *      body `{ text }` or a raw streaming/plain-text body, re-chunked into words for smooth lip-sync.
 *   3. HTTP 503 (chat_not_configured) OR any non-200 OR a network/fetch error -> fall back to the
 *      tasteful "opens at launch" lines below, which ARE the honest pre-launch state (the avatar
 *      still speaks and lip-syncs, so the stage stays alive rather than dead).
 *
 * The moment the owner sets the `/api/chat` Worker key, chat goes live with NO front-end change:
 * this file already prefers the live bridge and only degrades when it is absent. The origin is never
 * hardcoded — `/api/chat` is relative (same-origin) on purpose.
 */
const LINES = [
  "i'm awake enough to stand here, but my full voice opens at launch.",
  "the bridge to my real brain isn't live yet — come back when i can actually talk.",
  "i can see you. i just can't answer properly until launch. soon.",
];

/** Enqueue a whole string word-by-word, then close. Shared by the fallback and the JSON path. */
function streamWords(text: string): ReadableStream {
  return new ReadableStream({
    start(controller: ReadableStreamDefaultController) {
      try {
        text
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

/** The honest pre-launch degrade: one tasteful in-character line, streamed like a real reply. */
function fallbackStream(): ReadableStream {
  return streamWords(LINES[Math.floor(Math.random() * LINES.length)]);
}

export async function getPreflightChatResponseStream(messages: Message[]) {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
  } catch {
    // Network / fetch error — honest fallback.
    return fallbackStream();
  }

  // 503 chat_not_configured, or any other non-200, or no body — honest fallback.
  if (!res.ok || !res.body) {
    return fallbackStream();
  }

  const contentType = res.headers.get("content-type") || "";

  // JSON reply: { text: "..." }
  if (contentType.includes("application/json")) {
    let text = "";
    try {
      const data = (await res.json()) as { text?: unknown };
      text = typeof data.text === "string" ? data.text : "";
    } catch {
      return fallbackStream();
    }
    return text ? streamWords(text) : fallbackStream();
  }

  // Streaming / plain-text body: re-chunk into words as it arrives so it stays a stream of tokens.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  return new ReadableStream({
    async start(controller: ReadableStreamDefaultController) {
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Split on whitespace but keep the separators so spacing survives; hold the trailing
          // partial token in `buffer` until more arrives.
          const parts = buffer.split(/(\s+)/);
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            if (part) controller.enqueue(part);
          }
        }
        buffer += decoder.decode();
        if (buffer) controller.enqueue(buffer);
      } catch (error) {
        controller.error(error);
      } finally {
        controller.close();
      }
    },
  });
}
