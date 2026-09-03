/**
 * THE DEV-LOOPBACK CREDENTIAL FOR THE THREE /api/* EXTERNAL-API ROUTES — the half of the gate that
 * both sides of the wire need.
 *
 * This file is deliberately free of any `node:` import. It is imported by `externalAPI.ts`, which
 * runs IN THE BROWSER (amica's own page is a legitimate caller of `/api/dataHandler`), so anything
 * Node-only in here would be dragged into the client bundle and break `next build`. The server-side
 * admission decision — constant-time compare, status codes, the NODE_ENV and flag checks — lives in
 * `gate.ts` next door, which imports this and is only ever imported by API routes.
 *
 * WHY A `NEXT_PUBLIC_` VARIABLE IS THE RIGHT SHAPE HERE, AND WHAT IT IS NOT.
 * The external API's own client code posts to `/api/dataHandler` from the page
 * (`handleConfig("init")`, `handleUserInput`, `handleChatLogs`, `handleSubconscious`), so the token
 * must reach the client bundle or the feature cannot function at all. That makes it a LOOPBACK
 * TOKEN, not a secret: its job is to stop an unauthenticated stranger with network reach to a dev
 * or staging box from writing amica's config file and choosing what the live VTuber says. It is not
 * a defence against someone who can read the page's JavaScript.
 *
 * Consequences, stated plainly because they are easy to get wrong:
 *   - NEVER set this in a production build. Next inlines every NEXT_PUBLIC_ value into JS served to
 *     everyone. `gate.ts` refuses outside NODE_ENV=development anyway, so setting it there buys
 *     nothing and leaks the value.
 *   - NEVER reuse a value that protects anything else.
 */

/**
 * Header a caller must present. Custom rather than `Authorization` on purpose: cross-origin
 * JavaScript cannot set a custom header without a CORS preflight, and these routes answer no
 * preflight — so a drive-by page cannot forge the call even from a browser that has the dev origin
 * open in another tab.
 */
export const EXTERNAL_API_TOKEN_HEADER = "x-amica-api-key";

/**
 * Minimum configured-token length. Short enough to paste into a `.env.local`, long enough that
 * guessing it over the network is not a strategy. A shorter value is treated as NO token — and
 * therefore as the feature being off — rather than accepted with a warning nobody reads.
 */
export const MIN_EXTERNAL_API_TOKEN_LENGTH = 16;

/**
 * The configured token, or null when there is none worth honouring.
 *
 * Written as a literal `process.env.NEXT_PUBLIC_...` member access on purpose: Next replaces that
 * exact text at build time. A computed lookup (`process.env[someName]`) is NOT replaced, would read
 * `undefined` in the browser bundle, and would silently lock amica's own page out of its own API
 * while the server kept answering 401 — the worst kind of failure, because it looks like a bug in
 * the caller rather than a missing configuration.
 */
export function externalApiToken(): string | null {
  const raw = (process.env.NEXT_PUBLIC_AMICA_EXTERNAL_API_TOKEN || "").trim();
  return raw.length >= MIN_EXTERNAL_API_TOKEN_LENGTH ? raw : null;
}

/**
 * The header bag to send with an external-API request, or `{}` when no token is configured.
 *
 * Returning `{}` rather than throwing keeps the client callers inert: they are already gated on
 * `isDev` and on the endpoint URL existing, and a missing token simply means the server will answer
 * 404 — the feature is off, which is the correct outcome, not an exception to handle.
 */
export function externalApiAuthHeaders(): Record<string, string> {
  const token = externalApiToken();
  return token ? { [EXTERNAL_API_TOKEN_HEADER]: token } : {};
}
