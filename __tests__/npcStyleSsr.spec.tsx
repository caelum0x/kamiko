/**
 * @jest-environment node
 *
 * (node, not jsdom: this suite exercises the SERVER renderer — the exact side of React that did
 * the escaping — and react-dom/server needs TextEncoder, which the jsdom test env does not carry.)
 *
 * npcStyleSsr.spec.tsx — the funnel pages' <style> must survive server rendering byte-for-byte.
 *
 * WHY: <style> is an HTML raw-text element. When its CSS was a JSX text child, React's server
 * renderer entity-escaped it (`.npcg-bar>span` → `.npcg-bar&gt;span`) and, because the HTML parser
 * never un-escapes raw text, the shipped page carried a dead child-combinator rule AND a
 * guaranteed hydration text mismatch — React threw away the whole server-rendered tree and
 * re-rendered client-side on every load of /game, /holder, /agents and /trust.
 *
 * Each assertion fails if any of those pages goes back to `<style>{css}</style>`.
 */
import { describe, expect, jest, test } from '@jest/globals';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AgentsPage from '@/pages/agents';
import GamePage from '@/pages/game';
import TrustPage from '@/pages/trust';
import { NPC_CSS } from '@/npc/styles';

// holder.tsx imports @solana/web3.js, whose rpc-websockets dependency does not parse under jest's
// node environment (nested ESM uuid). None of it runs during a server render — it is all inside
// click handlers — so a module-shaped stub is enough to render the page. `doMock` + require, not a
// hoisted `jest.mock`: next/jest's SWC transform does not hoist mock factories above the import
// graph here, so the real module would still load first.
jest.doMock('@solana/web3.js', () => ({
  Connection: class {},
  PublicKey: class {},
  SystemProgram: { transfer: () => ({}) },
  Transaction: class {},
  LAMPORTS_PER_SOL: 1_000_000_000,
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const HolderPage = require('@/pages/holder').default as () => React.ReactElement;

const PAGES: Array<[string, () => React.ReactElement]> = [
  ['agents', () => <AgentsPage />],
  ['game', () => <GamePage />],
  ['holder', () => <HolderPage />],
  ['trust', () => <TrustPage />],
];

describe('funnel page <style> tags are emitted raw by the server renderer', () => {
  test.each(PAGES)('/%s ships un-escaped CSS (no &gt; in a raw-text element)', (_name, make) => {
    const html = renderToStaticMarkup(make());
    expect(html).toContain('<style>');
    // The one selector that made the bug visible: a child combinator inside the shared sheet.
    if (html.includes('npcg-bar')) expect(html).toContain('.npcg-bar>span');
    // No entity escapes inside any emitted style text — raw text is never un-escaped by browsers.
    for (const styleText of html.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
      expect(styleText[1]).not.toContain('&gt;');
      expect(styleText[1]).not.toContain('&amp;');
      expect(styleText[1]).not.toContain('&quot;');
    }
  });

  test('the shared sheet still contains the child combinator this guards', () => {
    // If the selector is ever refactored away the raw-text guard above stops being exercised for
    // it — this pins the fixture so the suite fails loudly instead of silently weakening.
    expect(NPC_CSS).toContain('.npcg-bar>span');
  });
});
