/**
 * funnelReachable.spec.ts — every funnel surface is reachable from the front door.
 *
 * WHY THIS FILE EXISTS, and it is a regression I shipped rather than a hypothetical.
 *
 * `/` is the URL a visitor actually lands on. `/game` (retention), `/holder` (tips and perks — the
 * revenue surface) and `/trust` (the mint check somebody does BEFORE buying) were once
 * direct-link-only orphans: they linked back to `/` and nothing linked forward. index.tsx carries a
 * comment about that, and about the trust page being the one that cost the most, because a person
 * who lands on `/` and wants to verify the contract had no path to the page that answers it.
 *
 * Three menu buttons fixed it. Then the tap panel moved onto the avatar screen and the `/game`
 * button became the panel's toggle — so the leaderboard, quests, the CTA, the wallet handshake and
 * the streak saver went straight back to being unreachable, and the only mention of `/game` left in
 * index.tsx was in prose explaining why. Nothing failed. The panel now carries the way forward, and
 * this file is what makes the next version of that mistake a red build instead of a quiet one.
 *
 * It is a SOURCE SCAN, not a render: index.tsx pulls in the VRM viewer, i18n and the whole settings
 * tree, and a test that mounts it would be testing three.js. What matters here is only whether a
 * path forward exists in the code at all, which is exactly what went missing.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(APP, rel), 'utf8');

/** Comments explain why a route matters; they are not a way to reach it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Strip string literals and JSX text too, for the same reason comments are stripped: PROSE IS NOT
 * A CHECK.
 *
 * Found by this file's own negative control. The unset-API assertion below looks for `configured`,
 * and the copy it is meant to guarantee says "this build has no funnel API configured (…)" — so
 * deleting the actual branch and keeping the sentence still passed. A gate a user-facing string can
 * satisfy is testing spelling.
 */
function codeOnly(source: string): string {
  return withoutComments(source)
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/>[^<>{}]+</g, '><');
}

/**
 * Every funnel route, and what a visitor loses when nothing on `/` leads to it. The `why` is in the
 * failure message on purpose: "route unreachable" is a fact, and the reason is what decides whether
 * somebody fixes it now or after the launch.
 */
const FUNNEL: ReadonlyArray<{ route: string; why: string }> = [
  { route: '/game', why: 'the clicker dashboard — the leaderboard, quests, the CTA, the wallet handshake and the streak saver' },
  { route: '/holder', why: 'the holder dashboard: tier, perks and SOL tips — the revenue surface' },
  { route: '/trust', why: 'the mint verification a person does BEFORE they buy; unreachable, they buy on trust or not at all' },
];

describe('the front door leads to every funnel surface', () => {
  const index = withoutComments(read('src/pages/index.tsx'));
  const panel = withoutComments(read('src/components/tapToWake.tsx'));
  // The panel took over the `/game` button, so a path from inside it counts as a path forward.
  const frontDoor = `${index}\n${panel}`;

  for (const { route, why } of FUNNEL) {
    it(`${route} is reachable from / — ${why}`, () => {
      // `router.push("/x")` is the form index.tsx uses deliberately: MenuButton's `href` is
      // window.open, which takes a raw URL and does NOT apply next.config.js's basePath, so on a
      // BASE_PATH deployment every one of those would open a 404.
      const pushed = new RegExp(`router\\.push\\(\\s*["'\`]${route}["'\`]`).test(frontDoor);
      const routed = new RegExp(`["'\`]${route}["'\`]`).test(frontDoor);
      // The reason is folded into the compared VALUE because jest's expect takes no message
      // argument: on a failure the diff prints the sentence, which is the part that decides whether
      // somebody fixes this now or after the launch.
      const verdict = pushed || routed
        ? 'reachable'
        : `UNREACHABLE — nothing on / leads to ${route}. It is ${why}, and a surface a visitor cannot reach is a surface that does not exist.`;
      expect(verdict).toBe('reachable');
    });
  }

  it('the tap panel offers the rest of the game, not just the tap', () => {
    // The specific regression: the panel replaced the only button that reached the dashboard.
    expect(panel).toMatch(/openDashboard/);
    expect(withoutComments(read('src/pages/index.tsx'))).toMatch(/openDashboard=\{[^}]*\/game/);
  });

  it('scans a real front door, so a rename cannot make this pass by finding nothing', () => {
    // The anchor. Without it, moving or renaming index.tsx would leave every assertion above
    // matching an empty string — the way the previous client scan in this repo rotted before it
    // was deleted.
    expect(index.length).toBeGreaterThan(2000);
    expect(index).toMatch(/MenuButton/);
    expect(panel).toMatch(/useWakeTaps/);
  });
});

/**
 * THE SECOND WAY A SURFACE STOPS EXISTING: it renders perfectly and talks to nothing.
 *
 * `NEXT_PUBLIC_NPC_API` is inlined at BUILD time, so a build shipped without it produces pages that
 * animate, count, fill a meter and change an avatar's face while npc-api has never heard from them.
 * /holder and /trust have always said so. Both tap surfaces did not: they counted into localStorage
 * and showed '…' for the global, which is exactly what a working page shows while it is loading.
 *
 * The rule is therefore: a page that reads `API` must also render something when it is unset.
 */
describe('a surface that talks to nothing says so', () => {
  const SURFACES = [
    { file: 'src/pages/game.tsx', what: 'the clicker dashboard' },
    { file: 'src/pages/holder.tsx', what: 'the holder dashboard — tier, perks and tips' },
    { file: 'src/pages/trust.tsx', what: 'the mint verification' },
    { file: 'src/components/tapToWake.tsx', what: 'the tap panel on the avatar screen' },
  ] as const;

  for (const { file, what } of SURFACES) {
    it(`${file} reports an unset NEXT_PUBLIC_NPC_API — ${what}`, () => {
      const src = codeOnly(read(file));
      // Either it reads `API` directly and branches on it, or it takes `configured` from the engine
      // (useWakeTaps), which is `Boolean(API)`. Both are a real check; neither is a comment.
      const branches = /!\s*API\b/.test(src) || /\bconfigured\b/.test(src);
      const verdict = branches
        ? 'reports it'
        : `SILENT — ${file} (${what}) reads the funnel API but renders nothing when NEXT_PUBLIC_NPC_API is unset. The page still animates, so a visitor cannot tell it is talking to nothing.`;
      expect(verdict).toBe('reports it');
    });
  }

  it('the engine is what both tap surfaces ask, so there is one answer', () => {
    // Two independent Boolean(API) checks are two things to forget to update.
    expect(read('src/npc/useWakeTaps.ts')).toMatch(/configured:\s*Boolean\(API\)/);
  });
});
