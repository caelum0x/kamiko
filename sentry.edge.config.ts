/**
 * Sentry, on the edge runtime (middleware and edge routes).
 *
 * Same rule and same history as sentry.client.config.ts: nothing is reported unless this deployment
 * supplies a DSN of its own. The one that shipped with the fork belonged to upstream Amica.
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
