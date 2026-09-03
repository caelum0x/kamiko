import { timingSafeEqual } from "node:crypto";

import { EXTERNAL_API_TOKEN_HEADER, externalApiToken } from "./token";

/**
 * THE SERVER-SIDE ADMISSION GATE FOR THE THREE /api/* EXTERNAL-API ROUTES.
 *
 * Node-only (it imports `node:crypto`) and imported ONLY by API routes. The half of the mechanism
 * the browser also needs — the header name and the token accessor — is in `token.ts`, which has no
 * `node:` imports for exactly that reason.
 *
 * WHAT WAS WRONG. `/api/dataHandler`, `/api/amicaHandler` and `/api/mediaHandler` are upstream
 * amica's "external API" — a local automation surface for driving the avatar from a script. They
 * ship on the same Next origin that serves /holder, the page that asks a visitor's wallet to sign.
 * Three concrete holes:
 *
 *   1. `dataHandler` had NO check at all. `POST /api/dataHandler?type=config` with any JSON body
 *      wrote it verbatim into a file on disk, and `GET` read every one of the five storage files
 *      back to any anonymous caller — an unauthenticated persistent write and a ~1 MB-per-request
 *      disk-fill primitive on the money origin. Four of the five writers in `dataHelper.ts` gated
 *      themselves; `updateConfig`, the one that matters most, did not.
 *   2. `amicaHandler`'s `external_api_enabled` check sat BELOW the `req.method === "GET"` branch,
 *      so the one method that costs us a socket — an unbounded keep-alive SSE connection retained
 *      in a module-scope array for the process lifetime — was reachable while the API was
 *      "disabled".
 *   3. The gate that did exist read `config('external_api_enabled')`, and `config()` falls back to
 *      `serverConfig`, which is loaded out of the very file hole 1 let a stranger write. The switch
 *      that turns the feature on was reachable from the feature's own unauthenticated write: flip
 *      `external_api_enabled` to "true", then use `Update System Prompt` to choose what the live
 *      VTuber says.
 *
 * WHAT THIS DOES ABOUT IT. One admission decision, imported by all three routes, that fails closed
 * on four independent conditions — every one sourced from the deployment ENVIRONMENT, never from
 * anything an HTTP caller can influence:
 *
 *   - NODE_ENV must be "development". This is a local automation surface; it has no business
 *     answering on a production origin, and `handleConfig` (externalAPI.ts) already refuses to load
 *     its config outside dev, so the feature is half-dead there regardless. 404 is the honest
 *     answer: as far as a production caller is concerned the route does not exist.
 *   - NEXT_PUBLIC_EXTERNAL_API_ENABLED must be exactly "true", read from `process.env` DIRECTLY and
 *     deliberately NOT through `config()`. That is the fix for hole 3: `config()` prefers
 *     `serverConfig` over the env default, so routing the gate through it would let the feature
 *     re-enable itself out of an attacker-written file. An on-switch the guarded thing can flip is
 *     not a switch.
 *   - A token must be configured (see token.ts). "Enabled with no credential" is precisely the
 *     state that made this reportable, so it is not a state this gate has: no token, not enabled.
 *   - The request must present that token in `x-amica-api-key`, compared in constant time.
 *
 * The decision is a value, not a side effect, so a route cannot half-apply it: every caller either
 * returns on `ok: false` or proceeds, and the SSE route can now refuse BEFORE it opens a socket.
 */

export type ExternalApiAdmission =
  | { ok: true }
  /** The feature is off — wrong NODE_ENV, flag not "true", or no usable token configured. */
  | { ok: false; status: 404; reason: "disabled" }
  /** The feature is on and the caller did not present the configured token. */
  | { ok: false; status: 401; reason: "unauthenticated" };

/**
 * Is the external API switched on for this process?
 *
 * All three conditions come from the environment. Nothing an HTTP caller sends, and nothing stored
 * under `dataHandlerStorage/`, participates in this decision — see hole 3 above.
 */
export function externalApiEnabled(): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  if ((process.env.NEXT_PUBLIC_EXTERNAL_API_ENABLED || "").trim() !== "true") return false;
  return externalApiToken() !== null;
}

/**
 * Constant-time string compare. Not because a timing oracle on a local dev token is a realistic
 * attack, but because `===` on a credential is the habit that turns fatal the day the credential
 * gets shorter or the route gets exposed.
 */
function tokenEquals(presented: string, configured: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(configured, "utf8");
  // timingSafeEqual throws on a length mismatch, which is itself a length oracle. The length is not
  // the secret here, so refusing early is fine and keeps the compare total.
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Decide whether one request may touch the external API.
 *
 * Takes the header bag rather than the whole `NextApiRequest` so it is callable — and testable —
 * without constructing a Next request, and so no route can accidentally hand it something from the
 * body.
 *
 * CALL THIS BEFORE ACQUIRING ANY RESOURCE. That is the whole point of finding [9]: a refusal that
 * happens after `res.setHeader("Connection", "keep-alive")` and a push onto `sseClients` has
 * already cost us the socket it was supposed to refuse.
 */
export function admitExternalApi(
  headers: Record<string, string | string[] | undefined> | undefined,
): ExternalApiAdmission {
  const configured = externalApiToken();
  if (!externalApiEnabled() || configured === null) {
    return { ok: false, status: 404, reason: "disabled" };
  }

  const raw = headers?.[EXTERNAL_API_TOKEN_HEADER];
  // Node lower-cases incoming header names, but a duplicated header arrives as an array. Taking
  // [0] rather than joining means a second copy of the header cannot be used to smuggle anything
  // past the compare.
  const presented = Array.isArray(raw) ? raw[0] : raw;
  if (typeof presented !== "string" || !tokenEquals(presented, configured)) {
    return { ok: false, status: 401, reason: "unauthenticated" };
  }

  return { ok: true };
}

/**
 * Apply an admission refusal to a Next response, and say whether the caller must stop.
 *
 * A disabled route answers a bare 404 with no body: the operator learns nothing from a body, and a
 * stranger probing for the automation surface should not be able to tell "off" from "not built".
 * A 401 does carry a one-word reason, because at that point the feature IS on and the only person
 * who can be hitting it is an operator who mistyped their token.
 */
export function refuseExternalApi(
  // Structurally typed rather than `NextApiResponse` so the gate stays importable from a test with a
  // two-method fake. `json` takes `any` because the three routes narrow their own response bodies
  // (`NextApiResponse<ApiResponse>`), and a stricter parameter here would reject them.
  res: { status: (code: number) => { end: () => void; json: (body: any) => void } },
  admission: ExternalApiAdmission,
): boolean {
  if (admission.ok) return false;
  if (admission.status === 401) {
    res.status(401).json({ error: "unauthenticated" });
  } else {
    res.status(404).end();
  }
  return true;
}
