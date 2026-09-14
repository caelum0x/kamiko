/**
 * sentryDestination.spec.ts — this deployment reports to its own account or to nowhere.
 *
 * WHAT HAPPENED. The three sentry.*.config.ts files and the `withSentryConfig` block in
 * next.config.js arrived with the Amica fork and still carried Amica's own wizard output: a
 * hardcoded DSN, `org: "heyamica"`, `project: "chat-heyamica"`. Nothing here ever touched them, so
 * every production error from this site was delivered to a different project's Sentry account —
 * along with, because `replayIntegration` ran at a 0.1 SESSION sample rate, a full DOM recording of
 * one visit in ten. On this product a recording contains the conversation somebody had with her and
 * whatever their wallet is showing. None of it was readable by anyone here and none of it was ours
 * to send.
 *
 * A fix like this is invisible the moment it is made and trivially undone — a Sentry wizard re-run
 * writes the same literals straight back in, and nothing would fail. That is what this file is for.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');

/**
 * The file with its prose removed.
 *
 * Every one of these files now EXPLAINS in a comment which org the old literals pointed at and what
 * that cost — so a scan of the raw text finds "heyamica" in the documentation of its own fix and
 * fails on it. Block comments and whole-line `//` comments go; a `//` in the middle of a line stays,
 * so a URL inside a string literal is still searchable, which is the only place one could hide.
 */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const CONFIGS = ['sentry.client.config.ts', 'sentry.server.config.ts', 'sentry.edge.config.ts'];
const ALL = [...CONFIGS, 'next.config.js'];

describe('no hardcoded destination anywhere', () => {
  it('no file contains a literal DSN', () => {
    // A Sentry DSN is a URL with a public key in it; this is the shape, not the specific old value,
    // because the point is that NO literal DSN belongs in the repo.
    const offenders = ALL.filter((f) =>
      /https:\/\/[0-9a-f]{16,}@[\w.-]*ingest[\w.-]*sentry\.io/i.test(codeOnly(read(f))),
    );
    expect(offenders).toEqual([]);
  });

  it("no file names somebody else's org or project", () => {
    const offenders = ALL.filter((f) => /heyamica/i.test(codeOnly(read(f))));
    expect(offenders).toEqual([]);
  });

  it('the build plugin takes its org and project from the environment', () => {
    const next = read('next.config.js');
    expect(next).toContain('org: process.env.SENTRY_ORG');
    expect(next).toContain('project: process.env.SENTRY_PROJECT');
  });
});

describe('silence is the default', () => {
  for (const file of CONFIGS) {
    it(`${file} reports nothing without a DSN in the environment`, () => {
      const src = read(file);
      // Both halves of the condition: production alone would send to whatever was compiled in, and a
      // DSN alone would spray local development into the live issue stream.
      expect(src).toContain('Boolean(dsn)');
      expect(src).toContain("process.env.NODE_ENV === 'production'");
      expect(src).toMatch(/dsn\s*=\s*\(?process\.env\./);
    });
  }
});

describe('session replay is only ever recorded around an error', () => {
  it('ordinary sessions are not sampled', () => {
    const client = read('sentry.client.config.ts');
    /*
     * The number is the whole assertion. `replaysSessionSampleRate: 0.1` recorded the DOM of one in
     * ten visits whether or not anything went wrong — on a page where the DOM is somebody's chat
     * with her and, on /holder, their wallet. Error-triggered replays keep what replay is for.
     */
    expect(client).toContain('replaysSessionSampleRate: 0');
    expect(client).not.toMatch(/replaysSessionSampleRate:\s*0\.\d/);
    expect(client).toContain('replaysOnErrorSampleRate: 1.0');
  });
});
