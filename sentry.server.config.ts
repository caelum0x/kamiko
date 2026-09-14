/**
 * Sentry, on the server.
 *
 * Same rule and same history as sentry.client.config.ts: the DSN that shipped here was upstream
 * Amica's, so this fork's server errors were being delivered to somebody else's project. Nothing is
 * reported unless this deployment supplies SENTRY_DSN (or NEXT_PUBLIC_SENTRY_DSN, which the browser
 * bundle already needs — accepted here so a single variable configures both halves).
 */
import * as Sentry from "@sentry/nextjs";

const dsn = (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)?.trim();

Sentry.init({
  dsn,

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  enabled: Boolean(dsn) && process.env.NODE_ENV === 'production',
});
