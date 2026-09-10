/**
 * devMode.ts — the one answer to "is this visitor a developer?".
 *
 * WHY IT EXISTS (NEXT-PHASES.md P1#4). The stage's menu is upstream amica's DEV menu, and some of
 * it is not a consumer surface at all: `/share` is amica's character creator and `/import` loads
 * somebody else's character file. On a token's live VTuber stage, those two invite a visitor to
 * REPLACE Kamiko with a VRM of their own — which is a wonderful tool and the wrong door to put on
 * the front of the shop. They were reachable in one click, unlabelled as developer tools.
 *
 * The owner's instruction was "develop, don't trim", so nothing is deleted: this gates them behind
 * `?dev=1` and leaves every route working for anyone who knows it. A developer opts in once and
 * the choice sticks for the tab; a visitor never sees the tools and never loses anything they came
 * for.
 *
 * WHY sessionStorage AND NOT localStorage: `?dev=1` is a thing you turn on to do a piece of work,
 * not a preference. Persisting it forever means the owner enables it once on their phone in March
 * and is still looking at a developer build in December, wondering why the stage looks busy. A tab
 * is the right lifetime — and `?dev=0` turns it off explicitly without clearing site data.
 *
 * IT IS NOT A SECURITY BOUNDARY, and nothing behind it pretends to be. Every route it hides is
 * still routable by typing the URL, exactly as before. It is an audience decision, not an
 * authorization one — the things that ARE authorization (the kill-switch, the operator token, the
 * wallet session) live on the server and are unaffected by this.
 */

/** The query parameter that turns it on (`?dev=1`) or explicitly off (`?dev=0`). */
export const DEV_PARAM = 'dev';

/** Where the opt-in is remembered for the life of the tab. */
export const DEV_STORAGE_KEY = 'npc_dev_mode';

/**
 * PURE. Resolve dev mode from a URL search string and whatever was already remembered.
 *
 * Exported separately from the DOM reader so the precedence is unit-testable: an explicit
 * `?dev=0` must BEAT a remembered opt-in, or a developer who wants to see the consumer stage has
 * no way back without clearing storage.
 */
export function resolveDevMode(search: string, remembered: boolean): boolean {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search || '');
  } catch {
    return remembered;
  }
  const raw = params.get(DEV_PARAM);
  if (raw === null) return remembered;
  // Anything that is not an explicit off is an on: `?dev`, `?dev=1`, `?dev=true`, `?dev=yes`.
  // Being generous here costs nothing — the parameter is a convenience, not a credential — and a
  // developer who typed `?dev` and got the consumer stage would reasonably call that broken.
  const off = raw === '0' || raw.toLowerCase() === 'false' || raw.toLowerCase() === 'off';
  return !off;
}

/**
 * Read dev mode in the browser, remembering an explicit choice for the tab.
 *
 * SSR-safe: with no `window` it answers false, which is the consumer stage — the right default for
 * a server render, and the same thing the first paint shows before hydration, so the menu does not
 * flicker a developer's extra buttons at every visitor.
 */
export function readDevMode(): boolean {
  if (typeof window === 'undefined') return false;
  let remembered = false;
  try {
    remembered = window.sessionStorage.getItem(DEV_STORAGE_KEY) === '1';
  } catch {
    // Private mode, or storage blocked. A visitor who cannot be remembered is a visitor.
  }
  const resolved = resolveDevMode(window.location.search, remembered);
  try {
    // Persist only an EXPLICIT choice, so a plain reload keeps whatever the tab already decided
    // rather than silently clearing it.
    if (new URLSearchParams(window.location.search).get(DEV_PARAM) !== null) {
      if (resolved) window.sessionStorage.setItem(DEV_STORAGE_KEY, '1');
      else window.sessionStorage.removeItem(DEV_STORAGE_KEY);
    }
  } catch {
    // Storage refused the write; the flag still applies to this page view.
  }
  return resolved;
}
