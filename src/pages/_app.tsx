import '@/i18n';

import "@/styles/globals.css";
import "@charcoal-ui/icons";
import type { AppProps } from "next/app";

import { StageBoundary } from "@/components/stageBoundary";

/*
 * THE BOUNDARY IS HERE, NOT IN index.tsx, ON PURPOSE.
 *
 * `/` is the page that can actually throw — WebGL, a 20MB VRM, a lip-sync worker, an audio graph —
 * so it is tempting to wrap only the stage. But /holder is the tipping and perks surface and /trust
 * is the page somebody opens specifically to check a mint before spending money, and React's answer
 * to an uncaught error is a blank document on any of them. A wallet adapter throwing on /holder
 * deserves the same floor as three.js throwing on `/`.
 *
 * Wrapping `<Component/>` rather than each page also means the boundary survives client-side
 * navigation, which is what lets it clear itself on a route change instead of pinning one crash to
 * the rest of the session (see stageBoundary.tsx).
 */
export default function App({ Component, pageProps }: AppProps) {
  return (
    <StageBoundary>
      <Component {...pageProps} />
    </StageBoundary>
  );
}
