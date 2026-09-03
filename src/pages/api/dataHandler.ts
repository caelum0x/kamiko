import type { NextApiRequest, NextApiResponse } from 'next';
import { writeFile } from '@/features/externalAPI/utils/apiHelper';
import { admitExternalApi, refuseExternalApi } from '@/features/externalAPI/gate';
import { chatLogsFilePath, handleGetChatLogs, handleGetConfig, handleGetLogs, handleGetSubconscious, handleGetUserInputMessages, handlePostChatLogs, handlePostConfig, handlePostLogs, handlePostSubconscious, handlePostUserInputMessages, logsFilePath, subconsciousFilePath, userInputMessagesFilePath } from '@/features/externalAPI/dataHelper';

/**
 * Truncate the four append-only storage files once, on first admitted request.
 *
 * This used to be four bare `writeFile(...)` calls at MODULE SCOPE. Two things were wrong with
 * that. It ran on every cold start of a process that merely ROUTED to this file — including a
 * production `next start`, where the external API is off and must never touch the filesystem — and
 * it ran before any gate, so the one unavoidable side effect of the module happened for callers the
 * module was about to refuse. A feature that is disabled should be inert on disk, not "disabled
 * except for the part that writes".
 *
 * It is deferred to the first request that actually passes `admitExternalApi`, and latched so a
 * second request does not wipe the log the first one just started writing.
 */
let storageCleared = false;
function clearStorageOnce() {
  if (storageCleared) return;
  storageCleared = true;
  writeFile(subconsciousFilePath, []);
  writeFile(logsFilePath, []);
  writeFile(userInputMessagesFilePath, []);
  writeFile(chatLogsFilePath, []);
}

/**
 * The dev-only external API's data store.
 *
 * WHAT THIS GUARD IS FOR. This route previously had no authentication, no NODE_ENV check and no
 * enabled-check: it dispatched straight to the handlers. `POST ?type=config` with any JSON object
 * wrote it verbatim into `src/features/externalAPI/dataHandlerStorage/config.json`, and `GET` read
 * all five storage files back to any anonymous caller — on the same origin that serves /holder, the
 * page that asks a visitor's wallet to sign. Worse, the config it let a stranger write is the file
 * `config()` falls back to server-side, so the write could turn the rest of the external API on and
 * from there reach `Update System Prompt`.
 *
 * `admitExternalApi` (features/externalAPI/gate.ts) is now the first statement in the handler, so
 * the refusal happens before the query is parsed, before any file is read or written, and before
 * the one-time truncation above. See gate.ts for why every condition it checks is read from the
 * environment rather than from `config()`.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const admission = admitExternalApi(req.headers);
  if (refuseExternalApi(res, admission)) return;

  clearStorageOnce();

  const { type } = req.query;

  if (!['config', 'subconscious', 'logs', 'userInputMessages', 'chatLogs'].includes(type as string)) {
    return res.status(400).json({ error: 'Invalid type parameter' });
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGetRequest(type as string, res);
      case 'POST':
        return handlePostRequest(type as string, req, res);
      default:
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
}

const handleGetRequest = (type: string, res: NextApiResponse) => {
    let data;
    switch (type) {
      case 'config':
        data = handleGetConfig();
        break;
      case 'subconscious':
        data = handleGetSubconscious();
        break;
      case 'logs':
        data = handleGetLogs();
        break;
      case 'userInputMessages':
        data = handleGetUserInputMessages();
        break;
      case 'chatLogs':
        data = handleGetChatLogs();
        break;
      default:
        return res.status(400).json({ error: 'Invalid type' });
    }
    res.status(200).json(data);
  };

  const handlePostRequest = (type: string, req: NextApiRequest, res: NextApiResponse) => {
    const { body } = req;
    let response;

    switch (type) {
      case 'config':
        response = handlePostConfig(body);
        break;
      case 'subconscious':
        response = handlePostSubconscious(body);
        break;
      case 'userInputMessages':
        response = handlePostUserInputMessages(body);
        break;
      case 'logs':
        response = handlePostLogs(body);
        break;
      case 'chatLogs':
        response = handlePostChatLogs(body);
        break;
      default:
        return res.status(400).json({ error: 'Invalid type' });
    }

    res.status(200).json(response);
  };
