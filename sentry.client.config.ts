/**
 * Sentry, in the browser.
 *
 * THIS FILE ARRIVED WITH THE FORK AND POINTED SOMEWHERE ELSE. The DSN and the `org`/`project` in
 * next.config.js were upstream Amica's ("heyamica" / "chat-heyamica"), hardcoded by their setup
 * wizard and carried into this repo untouched by the monorepo reparent. Every production error from
 * kamiko.fun was therefore being delivered to a different project's Sentry account — and because
 * `replayIntegration` was on at a 10% SESSION sample rate, so were full DOM recordings of one in ten
 * visits: the chat somebody types to her, the wallet address on the holder dashboard, everything on
 * the screen. Nobody here could read any of it, and it was never ours to send.
 *
 * THE RULE NOW: report only where this deployment is explicitly told to. No DSN in the environment
 * means `enabled: false`, which makes every `Sentry.captureException` in the app — the stage error
 * boundary's included — a no-op that costs nothing. That is the correct default for a fork, for a
 * static `build:site` export, and for anyone who clones this repo: silence, not somebody else's
 * inbox.
 *
 * Set NEXT_PUBLIC_SENTRY_DSN (and SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN at build time for
 * source maps) to turn it on.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

Sentry.init({
  dsn,

  /*
   * Replay ONLY around an error, never as a sample of ordinary sessions.
   *
   * `replaysSessionSampleRate` was 0.1 — a full DOM recording of one visit in ten, whether or not
   * anything went wrong. On this product a recorded session contains the conversation a visitor had
   * with her and whatever their wallet is showing, which is not diagnostic data and is not worth
   * holding. Error-triggered replays keep the thing replay is actually for: seeing what the visitor
   * did in the seconds before the stage fell over.
   */
  integrations: [Sentry.replayIntegration()],
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  /*
   * Both conditions, not either. Production alone would have sent this to whichever DSN happened to
   * be compiled in; a DSN alone would spray local development into the live issue stream.
   */
  enabled: Boolean(dsn) && process.env.NODE_ENV === 'production',
});
