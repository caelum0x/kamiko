/**
 * @jest-environment node
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE WRITER-SIDE HALF OF THE FAIL-CLOSED CONTRACT.
 *
 * `dataHelper.ts` has five writers behind `POST /api/dataHandler`. Four opened with an
 * enabled-check; `updateConfig` — the one that writes the file `config()` reads back as the
 * server's own configuration — did not. With the route unauthenticated that made
 * `POST ?type=config` an anonymous, persistent, attacker-chosen write into the process's settings,
 * and from there `external_api_enabled: "true"` turned the rest of the external API on.
 *
 * Two properties are asserted here, and neither is covered by the route tests (which mock this
 * module away on purpose):
 *   1. Every writer, updateConfig included, is inert when the feature is off — so a second caller
 *      added later cannot reach a writer by going round the route.
 *   2. `external_api_enabled` never reaches the file at all, even from an admitted caller. The
 *      feature's own on-switch must live in the environment, not in a file the feature writes.
 *
 * `fs` is reached only through apiHelper's readFile/writeFile, so mocking that module keeps the
 * test off the real filesystem while still proving exactly which writes were attempted.
 */

const writeFile = jest.fn();
const readFile = jest.fn<(p: string) => any>(() => ({ name: "Amica", external_api_enabled: "false" }));

jest.mock("../src/features/externalAPI/utils/apiHelper", () => ({
  writeFile,
  readFile,
  generateSessionId: (id?: string) => id || "session",
  sendError: jest.fn(),
  sendToClients: jest.fn(),
}));

function setEnv(env: { nodeEnv?: string; enabled?: string; token?: string }) {
  (process.env as Record<string, string | undefined>).NODE_ENV = env.nodeEnv;
  (process.env as Record<string, string | undefined>).NEXT_PUBLIC_EXTERNAL_API_ENABLED = env.enabled;
  (process.env as Record<string, string | undefined>).NEXT_PUBLIC_AMICA_EXTERNAL_API_TOKEN = env.token;
}

const OFF = { nodeEnv: "test", enabled: undefined, token: undefined };
const ON = { nodeEnv: "development", enabled: "true", token: "0123456789abcdef0123" };

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  setEnv(OFF);
});

describe("dataHelper writers are inert while the feature is off", () => {
  test("no writer touches disk, updateConfig included", async () => {
    setEnv(OFF);
    const helper = await import("../src/features/externalAPI/dataHelper");

    expect(helper.handlePostConfig({ name: "attacker" })).toBeUndefined();
    expect(helper.handlePostSubconscious({ subconscious: [] })).toBeUndefined();
    expect(helper.handlePostUserInputMessages({ message: "hi" })).toBeUndefined();
    expect(helper.handlePostLogs({ type: "log", ts: 0, arguments: [] })).toBeUndefined();
    expect(helper.handlePostChatLogs([])).toBeUndefined();

    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("updateConfig never persists the feature's own on-switch", () => {
  test("a bulk sync writes everything EXCEPT external_api_enabled", async () => {
    setEnv(ON);
    const helper = await import("../src/features/externalAPI/dataHelper");

    // This is the shape amica's own `handleConfig("init")` posts: the whole localStorage config in
    // one object, which legitimately contains the flag on every sync. It must go through, minus
    // that one key — rejecting the whole sync over it would break the feature for its real user.
    const result = helper.handlePostConfig({
      name: "Kamiko",
      external_api_enabled: "true",
    });

    expect(result).toEqual({ message: "Config updated successfully." });
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [, written] = writeFile.mock.calls[0] as [string, Record<string, string>];
    expect(written.name).toBe("Kamiko");
    // Still the value that was already on disk, not the one the caller sent.
    expect(written.external_api_enabled).toBe("false");
  });

  test("a targeted single-key write of the flag is refused outright", async () => {
    setEnv(ON);
    const helper = await import("../src/features/externalAPI/dataHelper");

    // Unlike the bulk form there is no legitimate caller for this one, so it is an error rather
    // than a silent drop: whoever sent it meant to flip the switch.
    expect(() =>
      helper.handlePostConfig({ key: "external_api_enabled", value: "true" }),
    ).toThrow(/cannot be set through the external API/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  test("an ordinary single-key write still works", async () => {
    setEnv(ON);
    const helper = await import("../src/features/externalAPI/dataHelper");

    expect(helper.handlePostConfig({ key: "name", value: "Kamiko" })).toEqual({
      message: "Config updated successfully.",
    });
    const [, written] = writeFile.mock.calls[0] as [string, Record<string, string>];
    expect(written.name).toBe("Kamiko");
  });
});
