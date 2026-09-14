/**
 * stageBoundary.tsx — the page that exists so a thrown error is not a white screen.
 *
 * WHAT WAS THERE BEFORE: nothing. `_error.jsx` is Next's SERVER error page — it covers a 500 from
 * getInitialProps and a 404, and it is never reached when a component throws in the browser. React
 * 18's response to an uncaught render or effect error with no boundary above it is to unmount the
 * entire tree. On `/` that tree is the whole product, so the result is a blank document: no text,
 * no menu, no link to /trust, and nothing that even names the project. For a token whose front door
 * is judged by strangers in about four seconds, "blank page" and "scam" are the same screen.
 *
 * This is not a hypothetical failure path. The stage constructs a WebGLRenderer, loads a ~20MB VRM,
 * spins up a lip-sync worker and an audio graph, and on some routes a MediaPipe build. WebGL being
 * unavailable (hardware acceleration off, an old driver, an embedded webview) throws from the
 * constructor; a deploy landing while a tab is open makes the next lazy chunk a 404; a mid-range
 * phone with a dozen tabs open really does run out of GPU memory. features/stage/crash.ts is where
 * those are told apart and where the sentences live.
 *
 * THE SURFACE ITSELF IS THE POINT, and it is why this is not a five-line generic boundary:
 *
 *   1. IT STILL SAYS WHAT THE SITE IS. It renders the same AboutProse the stage's "what is this?"
 *      panel does — the description, the FAQ, and the links to /trust, /holder and /agents. On the
 *      one screen where the visitor has lost the product entirely, the page they are left with is
 *      still a page about Kamiko with a working path to the page that verifies the mint. That is
 *      worth more than any apology, and it is the thing a generic boundary throws away.
 *   2. IT OFFERS THE RIGHT BUTTON. "Try again" re-mounts the tree; "reload" throws the tab away.
 *      Those are different tools, and crash.ts decides which one can honestly be offered: on a
 *      device with no WebGL, "try again" is a button that re-throws on click, which reads as the
 *      site breaking twice.
 *   3. IT RETRIES EXACTLY ONCE. A deterministic crash behind a retry button is an invitation to a
 *      loop; after one failed attempt the offer is withdrawn and only the reload remains.
 *
 * It is mounted in _app.tsx, so it covers every route — /holder and /trust are the money and
 * verification surfaces and deserve the same floor as the stage.
 */
import * as React from 'react';
import Router from 'next/router';
import * as Sentry from '@sentry/nextjs';

import { classifyCrash, type CrashCopy } from '@/features/stage/crash';
import { AboutProse, DOCUMENT_SCALE } from '@/components/aboutPanel';

interface StageBoundaryProps {
  children: React.ReactNode;
}

interface StageBoundaryState {
  error: unknown;
  /** How many times "try again" has been pressed. One is the limit; see the header. */
  retries: number;
}

/** The dark document surface both the crash page and index.tsx's pre-hydration branch stand on. */
const PAGE = 'min-h-screen bg-slate-950 px-6 py-16 text-white';

function CrashSurface({
  copy,
  canRetry,
  onRetry,
}: {
  copy: CrashCopy;
  canRetry: boolean;
  onRetry: () => void;
}) {
  return (
    <main className={PAGE}>
      <div className="mx-auto w-full max-w-2xl">
        <div className="text-[10px] uppercase tracking-widest text-white/50">the 3D stage stopped</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">{copy.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/85">{copy.detail}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          {canRetry ? (
            <button
              onClick={onRetry}
              className="rounded-lg bg-white/15 px-3 py-1.5 text-xs hover:bg-white/25 focus-visible:bg-white/25"
            >
              try again
            </button>
          ) : null}
          {/*
            `location.reload` rather than `router.reload`: the next/router version re-runs the React
            tree inside the SAME document, which keeps every module, worker, audio context and
            leaked GPU handle this crash may have come from. A chunk that 404'd and a tab that ran
            out of memory are both only fixed by throwing the document away.

            Guarded because this component is rendered on the server too (the boundary is in _app),
            where `window` does not exist — and a crash page that crashes has nothing left to show.
          */}
          <button
            onClick={() => {
              if (typeof window !== 'undefined') window.location.reload();
            }}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20 focus-visible:bg-white/20"
          >
            reload the page
          </button>
        </div>

        {/*
          AND THE PAGE IS STILL ABOUT KAMIKO.
          Same prose as the stage's "what is this?" panel, same document scale as the pre-hydration
          page, and — the part that matters — the same working links to /trust, /holder and /agents.
          Somebody whose browser cannot draw her can still read what this is and still check the
          mint, which is the entire difference between a broken toy and a broken renderer.
        */}
        <div className={'mt-10 border-t border-white/15 pt-8 ' + DOCUMENT_SCALE}>
          <AboutProse />
        </div>
      </div>
    </main>
  );
}

export class StageBoundary extends React.Component<StageBoundaryProps, StageBoundaryState> {
  state: StageBoundaryState = { error: null, retries: 0 };

  /** Deliberately stores the raw thrown value: crash.ts is what knows how to read it. */
  static getDerivedStateFromError(error: unknown): Partial<StageBoundaryState> {
    return { error };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    /*
     * The component stack is the whole value of catching here rather than letting it reach
     * window.onerror: it names which of the stage's dozen subsystems threw. `captureException` is a
     * no-op when Sentry has no DSN (see sentry.client.config.ts — it is disabled unless the
     * deployment supplies one), so this costs nothing on a build that reports nowhere.
     */
    Sentry.captureException(error, {
      extra: { componentStack: info?.componentStack },
      tags: { surface: 'stage-boundary' },
    });
  }

  componentDidMount() {
    /*
     * A ROUTE CHANGE CLEARS THE CRASH.
     *
     * The boundary wraps `<Component/>` in _app, so its state outlives a client-side navigation:
     * without this, one crash on `/` would leave every subsequent in-app route showing this page,
     * including routes that work perfectly. The crash surface's own links are plain `<a href>` and
     * would reload anyway, but the settings menu, the funnel buttons and the browser's Back button
     * all navigate through the router.
     */
    Router.events.on('routeChangeComplete', this.clear);
  }

  componentWillUnmount() {
    Router.events.off('routeChangeComplete', this.clear);
  }

  private clear = () => {
    // Guarded: setState on every navigation would re-render the whole app for nothing.
    if (this.state.error != null) this.setState({ error: null, retries: 0 });
  };

  private retry = () => {
    this.setState((s) => ({ error: null, retries: s.retries + 1 }));
  };

  render() {
    if (this.state.error == null) return this.props.children;

    const copy = classifyCrash(this.state.error);
    return (
      <CrashSurface
        copy={copy}
        canRetry={copy.canRetry && this.state.retries < 1}
        onRetry={this.retry}
      />
    );
  }
}

export default StageBoundary;
