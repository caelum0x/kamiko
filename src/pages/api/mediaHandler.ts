import { NextApiRequest, NextApiResponse } from 'next';

import { TimestampedPrompt } from '@/features/amicaLife/eventHandler';
import { apiLogs } from './amicaHandler';

import { handleConfig } from '@/features/externalAPI/externalAPI';
import { admitExternalApi, refuseExternalApi } from '@/features/externalAPI/gate';
import { ApiResponse, generateSessionId, sendError } from '@/features/externalAPI/utils/apiHelper';
import { transcribeVoice } from '@/features/externalAPI/processors/voiceProcessor';
import { processImage } from '@/features/externalAPI/processors/imageProcessor';

import formidable from 'formidable';
import fs from "fs";

// Configure body parsing: disable only for multipart/form-data
export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * The dev-only external API's voice/image intake.
 *
 * Gated by the same `admitExternalApi` the other two routes use, for the same reasons (see
 * features/externalAPI/gate.ts) plus one specific to this file: `bodyParser` is DISABLED here and
 * the multipart branch hands the raw request to formidable, which spools uploads to a temp file.
 * The old order — `handleConfig("fetch")` first, then a `config()` check that could be satisfied by
 * a file a stranger had written — meant an unauthenticated caller could make this process perform
 * an outbound fetch and then a disk-backed upload. The gate now runs before either, so a refused
 * caller costs a status line and nothing on disk.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  const admission = admitExternalApi(req.headers);
  if (refuseExternalApi(res, admission)) return;

  // Syncing config to be accessible from server side
  await handleConfig("fetch");

  const currentSessionId = generateSessionId();
  const timestamp = new Date().toISOString();
  
  if (req.headers['content-type']?.includes('multipart/form-data')) {
    // Handle form-data
    const form = formidable({});
    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error("Form parsing error:", err);
        return sendError(res, currentSessionId, "Failed to parse form data.");
      }

      try {
        await handleRequest(currentSessionId, timestamp, fields, files, res);
      } catch (error) {
        console.error("Error in form processing:", error);
        sendError(res, currentSessionId, String(error), 500);
      }
    });
  } else {
    return sendError(res, currentSessionId, "Incorrect type");
  }
}

async function handleRequest(
  sessionId: string,
  timestamp: string,
  fields: any,
  files: any,
  res: NextApiResponse<ApiResponse>
) {
  let response: string | undefined | TimestampedPrompt[];
  let outputType: string | undefined;

  const inputType = fields?.inputType?.[0] || null;
  const payload = files?.payload?.[0] || null;

  if (!inputType) {
    throw new Error("Missing or invalid inputType field.");
  }

  if (!payload) {
    throw new Error("Payload file is missing.");
  }

  try {
    switch (inputType) {
      case "Voice":
        if (payload) {
          const filePath = payload.filepath;
          const fileBuffer = fs.readFileSync(filePath);
          const audioFile = new File([fileBuffer], "input.wav", { type: "audio/wav" });
          response = await transcribeVoice(audioFile);
          outputType = "Text";
        } else {
          throw new Error("Voice input file missing.");
        }
        break;

      case "Image":
        if (payload) {
          const imageBuffer = fs.readFileSync(payload.filepath);
          response = await processImage(imageBuffer);
          outputType = "Text";
        } else {
          throw new Error("Image input file missing.");
        }
        break;

      default:
        return sendError(res, sessionId, "Unknown input type.");
    }

    apiLogs.push({sessionId: sessionId,timestamp,inputType,outputType,response});
    res.status(200).json({ sessionId, outputType, response });
  } catch (error) {
    apiLogs.push({sessionId: sessionId,timestamp,inputType,outputType: "Error",error: String(error)});
    sendError(res, sessionId, String(error), 500);
  }
}