import { Message } from "./messages";

/**
 * preflightChat — same-origin chat bridge with an honest keyless fallback.
 *
 * Order of operations (the caller is unchanged — this still resolves to a word-by-word
 * ReadableStream the chat pipeline reads token by token):
 *   1. POST the conversation to same-origin `/api/chat` as `{ messages: {role, content}[] }`.
 *   2. HTTP 200 -> read the assistant reply and stream it back word-by-word (LIVE chat). The Worker
 *      answers with a complete JSON body `{ reply: "..." }`; we also tolerate `text`/`content`/
 *      `message` and the OpenAI `choices[].message.content` shape, and a plain-text body.
 *   3. HTTP 503 (chat_not_configured) OR any non-200 OR a network/fetch error OR an empty/error
 *      reply -> fall back to the tasteful "opens at launch" lines below (the avatar still speaks and
 *      lip-syncs, so the stage stays alive rather than dead).
 *
 * The origin is never hardcoded — `/api/chat` is relative (same-origin) on purpose.
 */
const LINES = [
  "i'm awake enough to stand here, but my full voice opens at launch.",
  "the bridge to my real brain isn't live yet — come back when i can actually talk.",
  "i can see you. i just can't answer properly until launch. soon.",
];

/** Enqueue a whole string word-by-word, then close. Shared by the fallback and the live path. */
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

/** Only accept a non-empty string. */
function str(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

/**
 * Pull the assistant text out of whatever shape the Worker returned. The deployed Worker answers
 * `{ reply: "..." }`; we also accept `text`/`content`/`message`, the OpenAI choices shape, and a
 * raw plain-text body. Returns "" when there is nothing usable (an error body → honest fallback).
 */
function extractReply(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  let data: unknown;
  try {
    data = JSON.parse(s);
  } catch {
    // Not JSON — the body itself is the reply (plain text / already-concatenated stream).
    return s;
  }
  if (!data || typeof data !== "object") return "";
  const obj = data as Record<string, unknown>;
  const choices = Array.isArray(obj.choices) ? (obj.choices[0] as Record<string, unknown> | undefined) : undefined;
  const message = choices?.message as Record<string, unknown> | undefined;
  const delta = choices?.delta as Record<string, unknown> | undefined;
  return (
    str(obj.reply) ||
    str(obj.text) ||
    str(obj.content) ||
    str(obj.message) ||
    str(message?.content) ||
    str(delta?.content) ||
    ""
  );
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

  // 503 chat_not_configured, or any other non-200 — honest fallback.
  if (!res.ok) {
    return fallbackStream();
  }

  const raw = await res.text().catch(() => "");
  const reply = extractReply(raw);
  return reply ? streamWords(reply) : fallbackStream();
}
