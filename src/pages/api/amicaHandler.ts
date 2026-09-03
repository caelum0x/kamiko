import type { NextApiRequest, NextApiResponse } from "next";

import { handleConfig, handleSubconscious } from "@/features/externalAPI/externalAPI";

import { generateSessionId, sendError, apiLogEntry, ApiResponse } from "@/features/externalAPI/utils/apiHelper";
import { admitExternalApi, refuseExternalApi } from "@/features/externalAPI/gate";
import { requestMemory, requestLogs, requestUserInputMessages, requestChatHistory } from "@/features/externalAPI/utils/requestHandler";
import { processNormalChat, triggerAmicaActions, updateSystemPrompt } from "@/features/externalAPI/processors/chatProcessor";

export const apiLogs: apiLogEntry[] = [];
export const sseClients: Array<{ res: NextApiResponse }> = [];

/**
 * Ceiling on simultaneously-held SSE connections.
 *
 * `sseClients` is a module-scope array that lives for the process lifetime and is only ever spliced
 * from `req.on("close")`. Without a ceiling, "how many Node response objects is this front end
 * pinned to?" is answered by whoever is calling it — and this is the front end that also serves
 * /game and /holder. Eight is generous for the actual use (one automation script, maybe a second
 * tab watching it) and small enough that exhausting it costs an operator a refresh rather than
 * costing every visitor the process.
 */
export const MAX_SSE_CLIENTS = 8;

/**
 * The dev-only external API's control surface.
 *
 * TWO THINGS WERE WRONG WITH THE ORDER OF THIS FUNCTION, and both are why the guard is now the
 * first statement in it:
 *
 *   1. The `external_api_enabled` check sat BELOW the `req.method === "GET"` branch. The GET branch
 *      returns, so the check was unreachable for GET — and GET is the method that opens a
 *      keep-alive SSE socket and pins a response object into `sseClients` forever. The route was
 *      "disabled" for everything except the one method that costs us a resource. A disabled route
 *      has to refuse BEFORE it acquires anything, or the refusal is decoration.
 *   2. It gated on `config("external_api_enabled")`, which falls back to `serverConfig` — loaded
 *      out of a file that `/api/dataHandler` used to let any anonymous caller write. The on-switch
 *      was reachable from the hole it was guarding. `admitExternalApi` reads the environment
 *      instead; see features/externalAPI/gate.ts.
 *
 * `handleConfig("fetch")` has also moved below the gate: it is an outbound fetch, so leaving it
 * above meant an unauthenticated caller could make this process issue a network request.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  const admission = admitExternalApi(req.headers);
  if (refuseExternalApi(res, admission)) return;

  // Syncing config to be accessible from server side
  await handleConfig("fetch");

  if (req.method === "GET") {
    handleSSEConnection(req, res);
    return;
  }

  const { sessionId, inputType, payload, noProcessChat = false } = req.body;
  const currentSessionId = generateSessionId(sessionId);
  const timestamp = new Date().toISOString();

  if (!inputType) {
    return sendError(res, currentSessionId, "inputType are required.");
  }

  try {
    const { response, outputType } = await processRequest(inputType, payload);
    apiLogs.push({sessionId: currentSessionId,timestamp,inputType,outputType,response,});
    res.status(200).json({ sessionId: currentSessionId, outputType, response });
  } catch (error) {
    apiLogs.push({sessionId: sessionId,timestamp,inputType,outputType: "Error",error: String(error)});
    sendError(res, currentSessionId, String(error), 500);
  }
}

const processRequest = async (inputType: string, payload: any) => {
  switch (inputType) {
    case "Normal Chat Message":
      return { response: await processNormalChat(payload), outputType: "Chat" };
    case "Memory Request":
      return { response: await requestMemory(), outputType: "Memory" };
    case "RPC Logs":
      return { response: await requestLogs(), outputType: "Logs" };
    case "RPC User Input Messages":
      return { response: await requestUserInputMessages(), outputType: "User Input" };
    case "Update System Prompt":
      return { response: await updateSystemPrompt(payload), outputType: "Updated system prompt" };
    case "Brain Message":
      return { response: await handleSubconscious(payload), outputType: "Added subconscious stored prompt" };
    case "Chat History":
      return { response: await requestChatHistory(), outputType: "Chat History" };
    case "Reasoning Server":
      return { response: await triggerAmicaActions(payload), outputType: "Actions" };
    default:
      throw new Error("Invalid input type");
  }
};

// Sub-functions
const handleSSEConnection = (
  req: NextApiRequest,
  res: NextApiResponse
): void => {
  // Refuse over the cap BEFORE any header is set and before the push, so a caller past the limit
  // costs us a 503 and nothing else. Pushing first and hoping for `close` is how the array grows
  // without bound: `close` is the client's decision, not ours.
  if (sseClients.length >= MAX_SSE_CLIENTS) {
    res.status(503).json({ error: `too many SSE clients (max ${MAX_SSE_CLIENTS})` });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");

  const client = { res };
  sseClients.push(client);

  req.on("close", () => {
    // `indexOf` returning -1 would make a bare splice(-1, 1) delete the LAST client instead of this
    // one — a disconnect that silently kills somebody else's stream. Check before removing.
    const at = sseClients.indexOf(client);
    if (at !== -1) sseClients.splice(at, 1);
    res.end();
  });
};

