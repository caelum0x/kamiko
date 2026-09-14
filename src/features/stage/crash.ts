/**
 * crash.ts — what to say to somebody when the stage falls over.
 *
 * WHY THIS EXISTS. `/` is not a document that fails gracefully; it is a WebGL canvas, a VRM rig, a
 * lip-sync worker, an audio graph and a MediaPipe build, all mounted into one React tree. When any
 * of those throws during render or in an effect, React unmounts the WHOLE tree — and because
 * `_error.jsx` only covers server errors and 404s, what the visitor gets is a white page. No text,
 * no explanation, no way back to the trust page, and nothing that says what this site even is.
 * That is the worst possible outcome for a token project: the one screen a stranger judges it by,
 * blank.
 *
 * The four things that actually take this tree down are not hypothetical:
 *
 *   WebGL is unavailable   — hardware acceleration off, a blocked canvas, an old driver, a
 *                            headless/embedded webview. three.js throws from the constructor.
 *   A chunk 404s           — a deploy landed while the tab was open, and the lazily-loaded route
 *                            chunk it asks for no longer exists. Reload is the only fix.
 *   An asset does not load — the VRM, an animation, a worker: a fetch that fails or times out.
 *   The device is out of   — the avatar plus its animation set is tens of megabytes of GPU memory;
 *   memory                   a mid-range phone with a dozen tabs open really does hit this.
 *
 * Each of those deserves a different sentence and a different offer. "Try again" on a device
 * without WebGL is a button that re-throws; "reload" on a transient fetch failure is a heavier
 * hammer than the situation needs. So the classification is a pure function, tested, rather than a
 * chain of `instanceof` checks inside a component nobody can mount in jsdom.
 *
 * THE COPY IS DELIBERATELY NOT APOLOGETIC AND NOT VAGUE. "Oops, something went wrong" tells the
 * visitor nothing they can act on. Naming the cause is what lets somebody turn hardware
 * acceleration back on instead of deciding the site is broken.
 */

/** The distinguishable ways this stage dies. `unknown` is the honest default, not a dumping ground. */
export type CrashKind = 'webgl' | 'chunk' | 'network' | 'memory' | 'unknown';

export interface CrashCopy {
  kind: CrashKind;
  /** One line, in the recovery surface's heading. States what happened, not how sorry we are. */
  title: string;
  /** Two or three sentences: the likely cause, and what the visitor can do about it. */
  detail: string;
  /**
   * Whether re-mounting the same tree in place could plausibly succeed.
   *
   * False for the deterministic failures — no WebGL, a chunk that is gone from the CDN, a device
   * out of memory — because there "try again" is a button that throws again on click, which reads
   * as the site being broken twice.
   */
  canRetry: boolean;
}

/**
 * PURE. Everything a thrown value can tell us about itself, flattened to one lowercase haystack.
 *
 * Not every throw is an Error: a rejected fetch wrapper, a worker `postMessage` of a plain object,
 * and three.js's own `throw 'string'` sites all reach an error boundary. `String(error)` on a plain
 * object yields "[object Object]", so the fields are read individually and a non-Error is still
 * searched rather than silently classified as `unknown`.
 */
export function crashText(error: unknown): string {
  if (error == null) return '';
  const parts: unknown[] = [];
  if (typeof error === 'object') {
    const e = error as Record<string, unknown>;
    parts.push(e.name, e.message, e.code, e.reason, e.type);
  } else {
    parts.push(error);
  }
  return parts
    .filter((p) => typeof p === 'string' || typeof p === 'number')
    .join(' ')
    .toLowerCase();
}

/**
 * PURE. Which of the four known failures this is, and what to tell the visitor.
 *
 * ORDER IS LOAD-BEARING. A `ChunkLoadError` message contains both "chunk" and "failed"/"fetch", and
 * an out-of-memory failure from the GPU path mentions WebGL — so the most specific and most
 * actionable tests run first. Getting this order wrong does not throw; it just shows somebody the
 * wrong advice, which is the failure mode this whole module exists to avoid.
 */
export function classifyCrash(error: unknown): CrashCopy {
  const text = crashText(error);

  // Chunk first: it looks like a network error AND like a script error, and it is the only one of
  // the five where the fix ("reload") is certain rather than likely.
  if (/chunkloaderror|loading chunk|loading css chunk|failed to import|dynamically imported module/.test(text)) {
    return {
      kind: 'chunk',
      title: 'Part of this page did not finish downloading',
      detail:
        'That almost always means a new version of the site shipped while this tab was open, so the file it asked for is no longer there. Reloading picks up the new version.',
      canRetry: false,
    };
  }

  // Memory before WebGL: a GPU allocation failure names both, and "close some tabs" is the useful
  // half of that sentence — "your browser cannot do WebGL" would be untrue and unhelpful.
  if (/out of memory|oom|allocation failed|allocation size overflow|insufficient memory/.test(text)) {
    return {
      kind: 'memory',
      title: 'This device ran out of memory for the 3D stage',
      detail:
        'Kamiko is a full 3D avatar with her animation set loaded into GPU memory, which is a lot to ask of a phone with many tabs open. Closing other tabs and reloading usually gives her enough room.',
      canRetry: false,
    };
  }

  if (/webgl|webgl2|getcontext|context lost|context_lost|create.*context|gpu|shader|three\.js/.test(text)) {
    return {
      kind: 'webgl',
      title: 'This browser could not start the 3D stage',
      detail:
        'Kamiko is drawn with WebGL. It is usually unavailable because hardware acceleration is switched off in the browser settings, because the graphics driver is very old, or because an extension is blocking canvas rendering. Everything else about the project is readable below.',
      canRetry: false,
    };
  }

  if (/failed to fetch|networkerror|network error|load failed|err_|timeout|timed out|abort/.test(text)) {
    return {
      kind: 'network',
      title: 'Something she needed did not load',
      detail:
        'A file the stage depends on — her model, an animation, or a worker — could not be fetched. If the connection is back, trying again is usually enough.',
      canRetry: true,
    };
  }

  return {
    kind: 'unknown',
    title: 'The stage stopped',
    detail:
      'Something inside the 3D stage threw an error and the page could not keep drawing it. Trying again re-builds the stage from scratch; if it stops again in the same place, reloading clears everything this tab was holding.',
    canRetry: true,
  };
}
