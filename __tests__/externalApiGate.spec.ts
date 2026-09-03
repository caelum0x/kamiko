/**
 * @jest-environment node
 */
import { afterEach, describe, expect, jest, test } from "@jest/globals";

import {
  admitExternalApi,
  externalApiEnabled,
  refuseExternalApi,
} from "../src/features/externalAPI/gate";
import {
  EXTERNAL_API_TOKEN_HEADER,
  MIN_EXTERNAL_API_TOKEN_LENGTH,
  externalApiAuthHeaders,
  externalApiToken,
} from "../src/features/externalAPI/token";

/*
 * THE FAIL-CLOSED CONTRACT OF THE THREE /api/* EXTERNAL-API ROUTES.
 *
 * These routes are upstream amica's local automation surface and they ship on the same Next origin
 * that serves /holder, the page that asks a visitor's wallet to sign. Before this gate existed
 * `/api/dataHandler` had no check of any kind — anonymous persistent write to a JSON file the
 * server later reads back as its own config — and `/api/amicaHandler` reached its disabled-check
 * only AFTER the `GET` branch had already opened an uncapped keep-alive SSE socket.
 *
 * Every assertion below is a state the gate must refuse. They are written as separate cases rather
 * than one table because each is an independent reason to be off: losing any one of them silently
 * would leave the other three looking like the feature still had a gate.
 *
 * `node` environment on purpose — gate.ts uses `node:crypto` for the constant-time compare, which
 * jsdom does not provide.
 */

const GOOD_TOKEN = "0123456789abcdef0123"; // 20 chars, over the 16-char floor

/** Set the three environment variables the gate consults, or clear one with `undefined`. */
function setEnv(env: {
  nodeEnv?: string;
  enabled?: string;
  token?: string;
}) {
  // NODE_ENV is readonly in @types/node; the gate reads it at CALL time (not module scope) exactly
  // so a test can move it, which is also what makes the check honest in a bundler that would
  // otherwise freeze it at build time.
  (process.env as Record<string, string | undefined>).NODE_ENV = env.nodeEnv;
  (process.env as Record<string, string | undefined>).NEXT_PUBLIC_EXTERNAL_API_ENABLED = env.enabled;
  (process.env as Record<string, string | undefined>).NEXT_PUBLIC_AMICA_EXTERNAL_API_TOKEN = env.token;
}

const ALL_GOOD = { nodeEnv: "development", enabled: "true", token: GOOD_TOKEN };

afterEach(() => {
  setEnv({ nodeEnv: "test", enabled: undefined, token: undefined });
});

describe("externalApiEnabled", () => {
  test("is off with nothing configured — the default deployment state", () => {
    setEnv({ nodeEnv: "test", enabled: undefined, token: undefined });
    expect(externalApiEnabled()).toBe(false);
  });

  test("is off in production even with the flag and a token set", () => {
    // The production origin serves /holder. A local automation surface has no business answering
    // there, and handleConfig() refuses to load its config outside dev anyway.
    setEnv({ ...ALL_GOOD, nodeEnv: "production" });
    expect(externalApiEnabled()).toBe(false);
  });

  test("is off when the flag is unset, however good the token is", () => {
    setEnv({ ...ALL_GOOD, enabled: undefined });
    expect(externalApiEnabled()).toBe(false);
  });

  test("is off when the flag is anything other than \"true\" — no truthy-ish values", () => {
    // "1", "yes" and "TRUE" are the values an operator reaches for by habit. None of them opens the
    // route: a security switch that guesses at intent is a switch nobody can audit from the env.
    for (const value of ["", "1", "TRUE", "yes", "false", "on"]) {
      setEnv({ ...ALL_GOOD, enabled: value });
      expect(externalApiEnabled()).toBe(false);
    }
  });

  test("surrounding whitespace on the flag is trimmed, not treated as a different value", () => {
    // A trailing space in a .env line or a compose YAML block is a configuration typo, not a
    // decision to leave the feature off — and silently disagreeing with the operator there is how
    // an hour gets lost.
    setEnv({ ...ALL_GOOD, enabled: " true\n" });
    expect(externalApiEnabled()).toBe(true);
  });

  test("is off when NO token is configured — \"enabled with no credential\" is not a state", () => {
    setEnv({ ...ALL_GOOD, token: undefined });
    expect(externalApiEnabled()).toBe(false);
  });

  test("is off when the configured token is under the length floor", () => {
    setEnv({ ...ALL_GOOD, token: "a".repeat(MIN_EXTERNAL_API_TOKEN_LENGTH - 1) });
    expect(externalApiToken()).toBeNull();
    expect(externalApiEnabled()).toBe(false);
  });

  test("is on only with dev + flag + a long enough token", () => {
    setEnv(ALL_GOOD);
    expect(externalApiEnabled()).toBe(true);
  });
});

describe("admitExternalApi", () => {
  test("refuses with 404 when the feature is off, whatever credential is presented", () => {
    setEnv({ nodeEnv: "test", enabled: undefined, token: undefined });
    // A correct-looking token must not change the answer: off is off, and the 404 must not tell a
    // prober that a token would have helped.
    const admission = admitExternalApi({ [EXTERNAL_API_TOKEN_HEADER]: GOOD_TOKEN });
    expect(admission).toEqual({ ok: false, status: 404, reason: "disabled" });
  });

  test("refuses with 401 when enabled and no credential is presented", () => {
    setEnv(ALL_GOOD);
    expect(admitExternalApi({})).toEqual({
      ok: false,
      status: 401,
      reason: "unauthenticated",
    });
    expect(admitExternalApi(undefined)).toEqual({
      ok: false,
      status: 401,
      reason: "unauthenticated",
    });
  });

  test("refuses a wrong token, including one that is merely a prefix of the real one", () => {
    setEnv(ALL_GOOD);
    for (const bad of [GOOD_TOKEN.slice(0, -1), GOOD_TOKEN + "x", GOOD_TOKEN.toUpperCase(), ""]) {
      expect(admitExternalApi({ [EXTERNAL_API_TOKEN_HEADER]: bad }).ok).toBe(false);
    }
  });

  test("admits the configured token", () => {
    setEnv(ALL_GOOD);
    expect(admitExternalApi({ [EXTERNAL_API_TOKEN_HEADER]: GOOD_TOKEN })).toEqual({ ok: true });
  });

  test("a duplicated header takes the first value and cannot be used to smuggle a second", () => {
    setEnv(ALL_GOOD);
    // Node hands a repeated header through as an array. Joining them would produce
    // "wrong, <good>" — a string that contains the real token — so the gate must index, not join.
    expect(admitExternalApi({ [EXTERNAL_API_TOKEN_HEADER]: ["wrong", GOOD_TOKEN] }).ok).toBe(false);
    expect(admitExternalApi({ [EXTERNAL_API_TOKEN_HEADER]: [GOOD_TOKEN, "wrong"] }).ok).toBe(true);
  });
});

describe("externalApiAuthHeaders", () => {
  test("is empty when no token is configured, so a caller stays inert rather than throwing", () => {
    setEnv({ nodeEnv: "test", enabled: undefined, token: undefined });
    expect(externalApiAuthHeaders()).toEqual({});
  });

  test("carries the token amica's own page needs to call its own API", () => {
    setEnv(ALL_GOOD);
    expect(externalApiAuthHeaders()).toEqual({ [EXTERNAL_API_TOKEN_HEADER]: GOOD_TOKEN });
  });
});

describe("refuseExternalApi", () => {
  test("a disabled route answers a bodiless 404 and tells the caller to stop", () => {
    const end = jest.fn();
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ end, json })) };

    const stop = refuseExternalApi(res as any, {
      ok: false,
      status: 404,
      reason: "disabled",
    });

    expect(stop).toBe(true);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(end).toHaveBeenCalled();
    // No body: an operator learns nothing from one, and a prober should not be able to tell "off"
    // from "not built".
    expect(json).not.toHaveBeenCalled();
  });

  test("an unauthenticated caller gets a 401 with a one-word reason", () => {
    const end = jest.fn();
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ end, json })) };

    expect(
      refuseExternalApi(res as any, { ok: false, status: 401, reason: "unauthenticated" }),
    ).toBe(true);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "unauthenticated" });
  });

  test("an admitted request is not refused and the caller keeps going", () => {
    const res = { status: jest.fn(() => ({ end: jest.fn(), json: jest.fn() })) };
    expect(refuseExternalApi(res as any, { ok: true })).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });
});
