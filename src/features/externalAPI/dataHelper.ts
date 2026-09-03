import { readFile, writeFile } from "./utils/apiHelper";
import path from "path";
import { externalApiEnabled } from "./gate";

// Define file paths
export const configFilePath = path.resolve(
  "src/features/externalAPI/dataHandlerStorage/config.json",
);
export const subconsciousFilePath = path.resolve(
  "src/features/externalAPI/dataHandlerStorage/subconscious.json",
);
export const logsFilePath = path.resolve(
  "src/features/externalAPI/dataHandlerStorage/logs.json",
);
export const userInputMessagesFilePath = path.resolve(
  "src/features/externalAPI/dataHandlerStorage/userInputMessages.json",
);
export const chatLogsFilePath = path.resolve(
  "src/features/externalAPI/dataHandlerStorage/chatLogs.json",
);

// GET Request Handlers
export const handleGetConfig = () => readFile(configFilePath);
export const handleGetSubconscious = () => readFile(subconsciousFilePath);
export const handleGetLogs = () => readFile(logsFilePath);
export const handleGetUserInputMessages = () =>
  readFile(userInputMessagesFilePath);
export const handleGetChatLogs = () => readFile(chatLogsFilePath);

// POST Request Handlers
export const handlePostConfig = (body: any) => updateConfig(body);
export const handlePostSubconscious = (body: any) => updateSubconscious(body);
export const handlePostUserInputMessages = (body: any) => updateUserInputMessages(body);
export const handlePostLogs = (body: any) => updateLogs(body);
export const handlePostChatLogs = (body: any) => updateChatLogs(body);

/**
 * Keys this store is NEVER allowed to hold, no matter who writes it.
 *
 * `config()` (utils/config.ts) falls back to `serverConfig`, and `serverConfig` is loaded straight
 * out of config.json — so a key written here is a key the server later believes. Letting the
 * external API's own on-switch live in a file the external API writes is a privilege loop: one
 * accepted write and the feature can keep itself on for the rest of the process's life, out of
 * reach of the environment that is supposed to decide it. `gate.ts` no longer consults `config()`
 * for that flag, and this list makes sure the value never even reaches the file — belt and braces,
 * because the next person to add a gate will reach for `config()` first.
 */
const CONFIG_KEYS_NEVER_STORED = new Set(["external_api_enabled"]);

// Update Functions
const updateConfig = (body: any) => {
  /*
   * updateConfig was the ONE writer in this file without a gate — the other four all open with the
   * same enabled-check — and it is the most dangerous of the five: it writes the file `config()`
   * reads back server-side. With `/api/dataHandler` unauthenticated, that made
   * `POST ?type=config` an anonymous, persistent, attacker-chosen write into the process's own
   * configuration. The route is authenticated now; the writer refuses on its own account too,
   * because a gate that exists in exactly one place is a gate that disappears the next time someone
   * adds a second caller.
   */
  if (!externalApiEnabled()) {
    return;
  }

  const config = readFile(configFilePath);
  if (body.key && body.value !== undefined) {
    const { key, value } = body;
    if (CONFIG_KEYS_NEVER_STORED.has(key)) {
      throw new Error(`Config key "${key}" cannot be set through the external API.`);
    }
    if (!config.hasOwnProperty(key)) {
      throw new Error(`Config key "${key}" not found.`);
    }
    config[key] = value;
    writeFile(configFilePath, config);
    return { message: "Config updated successfully." };
  }

  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    for (const [key, value] of Object.entries(body)) {
      // Dropped rather than rejected: amica's own `handleConfig("init")` POSTs the WHOLE localStorage
      // config in one object, so this key is present on every legitimate sync. Failing the sync over
      // it would break the feature; silently not persisting it is the behaviour that is both safe
      // and usable.
      if (CONFIG_KEYS_NEVER_STORED.has(key)) continue;
      config[key] = value;
    }
    writeFile(configFilePath, config);
    return { message: "Config updated successfully." };
  }

  throw new Error("Invalid body format.");
};

const updateSubconscious = (body: any) => {
  if (!externalApiEnabled()) {
    return;
  }

  if (!Array.isArray(body.subconscious)) {
    throw new Error("Subconscious data must be an array.");
  }
  writeFile(subconsciousFilePath, body.subconscious);
  return { message: "Subconscious data updated successfully." };
};

const updateUserInputMessages = (body: any) => {
  if (!externalApiEnabled()) {
    return;
  }

  let existingMessage = readFile(userInputMessagesFilePath);
  if (!Array.isArray(existingMessage)) {
    existingMessage = [];
  }
  existingMessage.push(body);
  writeFile(userInputMessagesFilePath, existingMessage);
  return { message: "User input messages updated successfully." };
};

const updateLogs = (body: any) => {
  if (!externalApiEnabled()) {
    return;
  }

  const { type, ts, arguments: logArguments } = body;
  const logEntry = { type, ts, arguments: logArguments };
  let existingLogs = readFile(logsFilePath);
  if (!Array.isArray(existingLogs)) {
    existingLogs = [];
  }
  existingLogs.push(logEntry);
  writeFile(logsFilePath, existingLogs);
  return { message: "Logs updated successfully." };
};

const updateChatLogs = (body: any) => {
  if (!externalApiEnabled()) {
    return;
  }

  if (!Array.isArray(body)) {
    throw new Error("Chat logs data must be an array.");
  }
  writeFile(chatLogsFilePath, body);
  return { message: "Chat logs data updated successfully." };
};
