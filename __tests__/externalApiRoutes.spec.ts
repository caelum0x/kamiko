/**
 * @jest-environment node
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE TWO ROUTE-LEVEL PROPERTIES THAT THE GATE'S OWN UNIT TESTS CANNOT COVER.
 *
 * `externalApiGate.spec.ts` proves the DECISION is fail-closed. This file proves the two things
 * that are about WHERE the decision is made in each handler, which is what both findings were
 * really about:
 *
 *   1. `/api/dataHandler` must refuse before it touches the filesystem. The four `writeFile` calls
 *      that truncate the storage files used to run at MODULE SCOPE — before any check, on every
 *      cold start, including a production `next start`. "Disabled except for the part that writes"
 *      is not disabled.
 *   2. `/api/amicaHandler` must refuse a GET before it opens an SSE socket. Its enabled-check used
 *      to sit BELOW the `req.method === "GET"` branch, so the one method that pins a Node response
 *      object into a module-scope array for the process lifetime was the one method the disabled
 *      state did not cover. And even when admitted, the array needs a ceiling.
 *
 * The heavy leaves (the LLM client, the social-media clients, `fs`) are mocked because none of them
 * is under test here — what is under test is that they are never reached.
 */

const GOOD_TOKEN = "0123456789abcdef0123";

function setEnv(env: { nodeEnv?: string; enabled?: string; token?: string }) {
  (process.env as Record<string, string | undefined>).NODE_ENV = env.nodeEnv;
  (process.env as Record<string, string | undefined>).NEXT_PUBLIC_EXTERNAL_API_ENABLED = env.enabled;
  (process.env as Record<string, string | undefined>).NEXT_PUBLIC_AMICA_EXTERNAL_API_TOKEN = env.token;
}

const OFF = { nodeEnv: "test", enabled: undefined, token: undefined };
const ON = { nodeEnv: "development", enabled: "true", token: GOOD_TOKEN };

/** A response double that records what a handler did to it. */
function fakeRes() {
  const rec = {
    statusCode: 0 as number,
    body: undefined as unknown,
    ended: false,
    headers: {} as Record<string, unknown>,
  };
  const res: any = {
    status(code: number) {
      rec.statusCode = code;
      return res;
    },
    json(body: unknown) {
      rec.body = body;
      rec.ended = true;
      return res;
    },
    end(body?: unknown) {
      if (body !== undefined) rec.body = body;
      rec.ended = true;
      return res;
    },
    setHeader(name: string, value: unknown) {
      rec.headers[name] = value;
      return res;
    },
    write: jest.fn(),
  };
  return { res, rec };
}

const writeFile = jest.fn();
const readFile = jest.fn(() => ({}));

jest.mock("@/features/externalAPI/utils/apiHelper", () => ({
  writeFile,
  readFile,
  generateSessionId: (id?: string) => id || "session",
  sendError: (res: any, sessionId: string, message: string, status = 400) =>
    res.status(status).json({ sessionId, error: message }),
  sendToClients: jest.fn(),
}));

const handleGetConfig = jest.fn(() => ({ from: "disk" }));
const handlePostConfig = jest.fn(() => ({ message: "written" }));

jest.mock("@/features/externalAPI/dataHelper", () => ({
  configFilePath: "/tmp/config.json",
  subconsciousFilePath: "/tmp/subconscious.json",
  logsFilePath: "/tmp/logs.json",
  userInputMessagesFilePath: "/tmp/userInputMessages.json",
  chatLogsFilePath: "/tmp/chatLogs.json",
  handleGetConfig,
  handleGetSubconscious: jest.fn(),
  handleGetLogs: jest.fn(),
  handleGetUserInputMessages: jest.fn(),
  handleGetChatLogs: jest.fn(),
  handlePostConfig,
  handlePostSubconscious: jest.fn(),
  handlePostUserInputMessages: jest.fn(),
  handlePostLogs: jest.fn(),
  handlePostChatLogs: jest.fn(),
}));

const handleConfig = jest.fn(async () => undefined);
jest.mock("@/features/externalAPI/externalAPI", () => ({
  handleConfig,
  handleSubconscious: jest.fn(),
  configUrl: null,
  userInputUrl: null,
  subconsciousUrl: null,
  logsUrl: null,
  chatLogsUrl: null,
  serverConfig: {},
  fetcher: jest.fn(),
}));

jest.mock("@/features/externalAPI/processors/chatProcessor", () => ({
  processNormalChat: jest.fn(),
  triggerAmicaActions: jest.fn(),
  updateSystemPrompt: jest.fn(),
}));

jest.mock("@/features/externalAPI/utils/requestHandler", () => ({
  requestMemory: jest.fn(),
  requestLogs: jest.fn(),
  requestUserInputMessages: jest.fn(),
  requestChatHistory: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  setEnv(OFF);
});

describe("/api/dataHandler is fail-closed", () => {
  test("importing the module writes NOTHING to disk", async () => {
    setEnv(OFF);
    await import("../src/pages/api/dataHandler");
    // The four truncating writes used to be module-scope statements. A route module being loaded is
    // not consent to erase four files.
    expect(writeFile).not.toHaveBeenCalled();
  });

  test("a disabled deployment answers 404 and never reaches a handler or the filesystem", async () => {
    setEnv(OFF);
    const { default: handler } = await import("../src/pages/api/dataHandler");
    const { res, rec } = fakeRes();

    handler(
      { method: "POST", query: { type: "config" }, headers: {}, body: { pwned: "yes" } } as any,
      res,
    );

    expect(rec.statusCode).toBe(404);
    expect(handlePostConfig).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  test("an enabled deployment still refuses an unauthenticated caller, before any write", async () => {
    setEnv(ON);
    const { default: handler } = await import("../src/pages/api/dataHandler");
    const { res, rec } = fakeRes();

    handler(
      { method: "POST", query: { type: "config" }, headers: {}, body: { pwned: "yes" } } as any,
      res,
    );

    expect(rec.statusCode).toBe(401);
    expect(handlePostConfig).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  test("a disabled deployment answers 404 to a GET too — the read side was public as well", async () => {
    setEnv(OFF);
    const { default: handler } = await import("../src/pages/api/dataHandler");
    const { res, rec } = fakeRes();

    handler({ method: "GET", query: { type: "config" }, headers: {} } as any, res);

    expect(rec.statusCode).toBe(404);
    expect(handleGetConfig).not.toHaveBeenCalled();
  });

  test("an authenticated caller gets through, and the truncation happens exactly once", async () => {
    setEnv(ON);
    const { default: handler } = await import("../src/pages/api/dataHandler");
    const auth = { "x-amica-api-key": GOOD_TOKEN };

    const first = fakeRes();
    handler({ method: "GET", query: { type: "config" }, headers: auth } as any, first.res);
    expect(first.rec.statusCode).toBe(200);
    expect(first.rec.body).toEqual({ from: "disk" });
    expect(writeFile).toHaveBeenCalledTimes(4);

    // Latched: a second request must not wipe the log the first one just started.
    const second = fakeRes();
    handler({ method: "GET", query: { type: "config" }, headers: auth } as any, second.res);
    expect(second.rec.statusCode).toBe(200);
    expect(writeFile).toHaveBeenCalledTimes(4);
  });
});

describe("/api/amicaHandler refuses GET before it opens a socket", () => {
  test("a disabled deployment answers 404 to GET and holds no SSE client", async () => {
    setEnv(OFF);
    const mod = await import("../src/pages/api/amicaHandler");
    const { res, rec } = fakeRes();

    await mod.default({ method: "GET", headers: {}, body: {} } as any, res);

    expect(rec.statusCode).toBe(404);
    // The three assertions that make this finding's fix real: no keep-alive header was set, no
    // response object was retained, and the outbound config fetch never happened either.
    expect(rec.headers["Connection"]).toBeUndefined();
    expect(mod.sseClients).toHaveLength(0);
    expect(handleConfig).not.toHaveBeenCalled();
  });

  test("an enabled deployment refuses an unauthenticated GET with 401, still holding no socket", async () => {
    setEnv(ON);
    const mod = await import("../src/pages/api/amicaHandler");
    const { res, rec } = fakeRes();

    await mod.default({ method: "GET", headers: {}, body: {} } as any, res);

    expect(rec.statusCode).toBe(401);
    expect(rec.headers["Connection"]).toBeUndefined();
    expect(mod.sseClients).toHaveLength(0);
  });

  test("an authenticated GET opens a stream, and the stream count is capped", async () => {
    setEnv(ON);
    const mod = await import("../src/pages/api/amicaHandler");
    mod.sseClients.length = 0;
    const auth = { "x-amica-api-key": GOOD_TOKEN };

    const opened: ReturnType<typeof fakeRes>[] = [];
    for (let i = 0; i < mod.MAX_SSE_CLIENTS; i++) {
      const f = fakeRes();
      opened.push(f);
      await mod.default({ method: "GET", headers: auth, on: jest.fn(), body: {} } as any, f.res);
      expect(f.rec.headers["Connection"]).toBe("keep-alive");
    }
    expect(mod.sseClients).toHaveLength(mod.MAX_SSE_CLIENTS);

    // One past the ceiling is refused with 503 and — the part that matters — costs no headers and
    // no array entry. Pushing first and waiting for `close` is how the array grew without bound.
    const over = fakeRes();
    await mod.default({ method: "GET", headers: auth, on: jest.fn(), body: {} } as any, over.res);
    expect(over.rec.statusCode).toBe(503);
    expect(over.rec.headers["Connection"]).toBeUndefined();
    expect(mod.sseClients).toHaveLength(mod.MAX_SSE_CLIENTS);

    mod.sseClients.length = 0;
  });
});
