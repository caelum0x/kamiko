import { subconsciousUrl, userInputUrl, logsUrl, chatLogsUrl } from "@/features/externalAPI/externalAPI";
import { externalApiAuthHeaders } from "@/features/externalAPI/token";

/*
 * Readers for the dev-only external API.
 *
 * Each URL is null whenever NEXT_PUBLIC_DEVELOPMENT_BASE_URL is unset — i.e. in every deployment
 * that does not run that feature. `fetch(null)` would request the string "null" against the current
 * origin and then throw on `.json()` of the 404's HTML, so the absence is checked here instead and
 * an empty result is returned. Empty is the truthful answer: there is no store to read from.
 */
const readJson = async (url: URL | null): Promise<any> => {
  if (!url) return null;
  try {
    // The token goes on this read too: /api/dataHandler is authenticated now, and this reader runs
    // inside the amicaHandler request that was itself admitted with the same credential.
    const response = await fetch(url, { headers: externalApiAuthHeaders() });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null; // the dev endpoint is not running; a viewer feature must not throw over it
  }
};

export const requestMemory = async () => readJson(subconsciousUrl);

export const requestLogs = async () => readJson(logsUrl);

export const requestUserInputMessages = async () => readJson(userInputUrl);

export const requestChatHistory = async () => readJson(chatLogsUrl);
