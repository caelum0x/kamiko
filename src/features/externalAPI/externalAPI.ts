import { config, defaults, prefixed } from "@/utils/config";
import isDev from "@/utils/isDev";
import { externalApiAuthHeaders } from "./token";
import {
  MAX_STORAGE_TOKENS,
  TimestampedPrompt,
} from "../amicaLife/eventHandler";
import { Message } from "../chat/messages";

/**
 * The dev-only external API's endpoint URLs.
 *
 * These were five `new URL(\`${process.env.NEXT_PUBLIC_DEVELOPMENT_BASE_URL}/api/dataHandler\`)`
 * calls at MODULE SCOPE. That variable is unset in every deployment that does not run the dev
 * external-API feature (it is gated behind `isDev` and `external_api_enabled` at every call site),
 * so the template produced the literal string "undefined/api/dataHandler" and the URL constructor
 * threw `TypeError: Invalid URL` the moment the module was imported — during `next build`'s page
 * data collection, failing the whole build for a feature the build is not even enabling.
 *
 * They are built lazily now, and `null` when there is no base URL to build them from. Null is the
 * honest value: without a base URL there is no endpoint, and the callers already return early in
 * exactly that situation.
 */
function endpoint(type: string): URL | null {
  const base = (process.env.NEXT_PUBLIC_DEVELOPMENT_BASE_URL || '').trim();
  if (!base) return null;
  let url: URL;
  try {
    url = new URL(`${base.replace(/\/+$/, '')}/api/dataHandler`);
  } catch {
    // A malformed base is the same as an absent one: the feature is off, and it must not take the
    // importing module down with it.
    return null;
  }
  url.searchParams.append('type', type);
  return url;
}

export const configUrl: URL | null = endpoint('config');
export const userInputUrl: URL | null = endpoint('userInputMessages');
export const subconsciousUrl: URL | null = endpoint('subconscious');
export const logsUrl: URL | null = endpoint('logs');
export const chatLogsUrl: URL | null = endpoint('chatLogs');

// Cached server config
export let serverConfig: Record<string, string> = {};

/*
 * Every call below carries `externalApiAuthHeaders()` (features/externalAPI/token.ts).
 * `/api/dataHandler` used to answer anyone; it now requires the dev-loopback token, and amica's own
 * page is one of its callers — so the token travels on the app's own requests too. When none is
 * configured the helper returns `{}` and the server answers 404, which is the correct outcome: the
 * feature is off.
 */
export async function fetcher(method: string, url: URL | null, data?: any) {
  // No base URL configured ⇒ no endpoint ⇒ nothing to call. Callers are already gated on `isDev`;
  // this is the second gate, so a misconfigured dev environment is inert rather than throwing.
  if (!url) return;
  let response: any;
  switch (method) {
    case "POST":
      try {
        response = await fetch(url, {
          method: method,
          headers: { "Content-Type": "application/json", ...externalApiAuthHeaders() },
          body: JSON.stringify(data),
        });
      } catch (error) {
        console.error("Failed to POST server config: ", error);
      }
      break;

    case "GET":
      try {
        response = await fetch(url, { headers: externalApiAuthHeaders() });
        if (response.ok) {
          serverConfig = await response.json();
        }
      } catch (error) {
        console.error("Failed to fetch server config:", error);
      }
      break;

    default:
      break;
  }
}

export async function handleConfig(
  type: string,
  data?: Record<string, string>,
) {
  if (!isDev) {
    return;
  }

  switch (type) {
    // Call this function at the beginning of your application to load the server config and sync to localStorage if needed.
    case "init":
      let localStorageData: Record<string, string> = {};

      for (const key in defaults) {
        const localKey = prefixed(key);
        const value = localStorage.getItem(localKey);

        if (value !== null) {
          localStorageData[key] = value;
        } else {
          // Append missing keys with default values
          localStorageData[key] = (<any>defaults)[key];
        }
      }

      // Sync update to server config
      await fetcher("POST", configUrl, localStorageData);

      break;
    case "fetch":
      // Sync update to server config cache
      await fetcher("GET", configUrl);

      break;

    case "update":
      await fetcher("POST", configUrl, data);

      break;

    default:
      break;
  }
}

export async function handleUserInput(message: string) {
  // The third condition is the endpoint itself: with no NEXT_PUBLIC_DEVELOPMENT_BASE_URL there is
  // no URL to post to, and the feature is off no matter what the config flag says.
  if (!isDev || config("external_api_enabled") !== "true" || !userInputUrl) {
    return;
  }

  fetch(userInputUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...externalApiAuthHeaders() },
    body: JSON.stringify({
      systemPrompt: config("system_prompt"),
      message: message,
    }),
  });
}

export async function handleChatLogs(messages: Message[]) {
  if (!isDev || config("external_api_enabled") !== "true" || !chatLogsUrl) {
    return;
  }

  fetch(chatLogsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...externalApiAuthHeaders() },
    body: JSON.stringify(messages),
  });
}

export async function handleSubconscious(
  timestampedPrompt: TimestampedPrompt,
): Promise<any> {
  if (!isDev || config("external_api_enabled") !== "true" || !subconsciousUrl) {
    return;
  }

  const data = await fetch(subconsciousUrl, { headers: externalApiAuthHeaders() });
  if (!data.ok) {
    throw new Error("Failed to get subconscious data");
  }

  const currentStoredSubconscious: TimestampedPrompt[] = await data.json();
  currentStoredSubconscious.push(timestampedPrompt);

  let totalStorageTokens = currentStoredSubconscious.reduce(
    (totalTokens, prompt) => totalTokens + prompt.prompt.length,
    0,
  );
  while (totalStorageTokens > MAX_STORAGE_TOKENS) {
    const removed = currentStoredSubconscious.shift();
    totalStorageTokens -= removed!.prompt.length;
  }

  const response = await fetch(subconsciousUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...externalApiAuthHeaders(),
    },
    body: JSON.stringify({ subconscious: currentStoredSubconscious }),
  });

  if (!response.ok) {
    throw new Error("Failed to update subconscious data");
  }

  return currentStoredSubconscious;
}
