/**
 * @jest-environment node
 *
 * (node, not jsdom — same reason as npcStyleSsr.spec.tsx: this renders with react-dom/server,
 * which needs TextEncoder, and the server render is the thing under test. What lands in the served
 * HTML is exactly what this suite asserts.)
 *
 * aboutPanel.spec.tsx — the page's only prose is in the page, open or closed.
 *
 * WHY THIS FILE EXISTS. `/` is a WebGL canvas: no indexable text, nothing announced to a screen
 * reader. The description and FAQ in aboutPanel.tsx are the entire answer to both, AND they are the
 * content that seoHead.tsx publishes as FAQPage structured data — markup whose whole premise is
 * that the questions and answers are on the page it describes.
 *
 * That makes "render it only when it is open" a one-line change that silently costs the page its
 * text and turns its structured data into a claim about content that is not there. Nothing would
 * fail; the stage would look identical. So the invariant is asserted on the RENDERED MARKUP rather
 * than by scanning the source for a pattern: closed, the panel must still be in the HTML.
 */
import { describe, expect, it } from '@jest/globals';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AboutPanel, AboutDocument, HOME_FAQ } from '@/components/aboutPanel';

const closed = renderToStaticMarkup(<AboutPanel open={false} onClose={() => {}} />);
const open = renderToStaticMarkup(<AboutPanel open onClose={() => {}} />);
const doc = renderToStaticMarkup(<AboutDocument />);

/** React escapes text into entities on the way out; compare against the same escaping. */
const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

/** Every href the markup actually emits. */
const hrefs = (markup: string) => Array.from(markup.matchAll(/href="([^"]*)"/g), (m) => m[1]);

describe('the prose is in the DOM whether or not the panel is open', () => {
  it('a CLOSED panel still carries the description', () => {
    // The sentence a crawler has to find to know what this page is.
    expect(closed).toContain('Kamiko, the live AI VTuber');
    expect(closed).toContain('interactive 3D AI VTuber experience');
    // Not painted, but present: `hidden` is display:none, it is not unmounting.
    expect(closed).toMatch(/<div[^>]*\shidden(=""|\s|>)/);
  });

  it('a CLOSED panel still carries every published FAQ question AND answer', () => {
    /*
     * The answers matter as much as the questions. A panel that rendered the questions and lazily
     * loaded the answers would look complete and still leave the FAQPage markup describing text
     * that never reached the page.
     */
    const missing = HOME_FAQ.flatMap(({ question, answer }) =>
      [
        closed.includes(escape(question)) ? null : `question: ${question}`,
        closed.includes(escape(answer)) ? null : `answer to: ${question}`,
      ].filter(Boolean),
    );
    // jest's expect takes no message argument, so the missing piece is named in the compared value.
    expect(missing.length ? `absent from the closed panel — ${missing.join('; ')}` : 'all present').toBe('all present');
  });

  /**
   * THE `hidden` ATTRIBUTE DOES NOT HIDE ANYTHING ON ITS OWN HERE, and this shipped broken once.
   *
   * `hidden` works through a stylesheet rule, not magic: Tailwind's preflight carries
   * `[hidden]{display:none}` in its BASE layer. Any `display` utility on the same element —
   * `flex`, `grid`, `block` — lives in the UTILITIES layer, later in the same file at the same
   * specificity, so it WINS. The panel had `hidden` and `flex` together and was painted full-height
   * over the avatar before anybody pressed the button; a screenshot of the built stage is what
   * found it, because every assertion about the markup was still perfectly true.
   *
   * So the check is about the class list, not the attribute: closed, the element may carry no
   * display utility except `hidden`.
   */
  const rootClass = (markup: string) => markup.match(/^<div[^>]*\sclass="([^"]*)"/)?.[1] ?? '';
  const DISPLAY_UTILITIES = ['flex', 'grid', 'block', 'inline', 'inline-flex', 'inline-block', 'table', 'contents', 'flow-root'];

  it('a CLOSED panel carries no display utility that would beat [hidden]', () => {
    const classes = rootClass(closed).split(/\s+/);
    expect(classes).toContain('hidden');
    const beating = DISPLAY_UTILITIES.filter((u) => classes.includes(u));
    // jest's expect takes no message argument, so the offender is named in the compared value.
    expect(beating.length ? `closed, but painted by: ${beating.join(', ')}` : 'not painted').toBe('not painted');
  });

  it('an OPEN panel lays out as the column it is', () => {
    expect(rootClass(open).split(/\s+/)).toContain('flex');
  });

  it('an OPEN panel is the same markup, painted', () => {
    expect(open).not.toMatch(/<div[^>]*\shidden(=""|\s|>)/);
    for (const { question } of HOME_FAQ) expect(open).toContain(escape(question));
  });

  it('the pre-hydration document renders the SAME prose, not a second copy of it', () => {
    // One <AboutProse/>, two surfaces. Two hand-maintained copies of this text would drift, and the
    // copy that drifts is the one nobody looks at — here, the one Google reads.
    expect(doc).toContain('Kamiko, the live AI VTuber');
    for (const { question, answer } of HOME_FAQ) {
      expect(doc).toContain(escape(question));
      expect(doc).toContain(escape(answer));
    }
  });
});

describe('nothing in it leaves for a surface that is on this screen', () => {
  it('emits no link to /game — the game is the panel over the avatar', () => {
    for (const [name, markup] of [['panel', open], ['document', doc]] as const) {
      const game = hrefs(markup).filter((h) => h === '/game' || h.startsWith('/game/'));
      expect(game.length ? `${name} links to ${game.join(', ')}` : 'no /game link').toBe('no /game link');
    }
  });

  it('links only to the three surfaces that are genuinely elsewhere', () => {
    // /trust, /agents and /holder are real separate pages and a sentence about them should link to
    // them. The point of the rewrite was not "no links", it was no links to a page whose content is
    // already on this screen — and no nav bar wearing a paragraph's clothes.
    expect(new Set(hrefs(open))).toEqual(new Set(['/agents', '/trust', '/holder']));
  });
});

describe('a panel floating over an avatar has to announce itself', () => {
  it('is a named region, and the name resolves to a heading that exists', () => {
    expect(open).toMatch(/role="region"/);
    const labelledBy = open.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(open).toContain(`id="${labelledBy}"`);
  });

  it('the close control has an accessible name — it is an icon, so it has no text', () => {
    expect(open).toMatch(/aria-label="close what is this"/);
  });

  it('bounded and scrollable, so no line is unreachable over the stage', () => {
    // It is anchored to the menu rail at the top and grows DOWN; without a ceiling the FAQ runs off
    // the bottom of a laptop viewport, and on a phone it would cover her entirely.
    expect(open).toMatch(/max-h-\[/);
    expect(open).toMatch(/overflow-y-auto/);
  });
});

describe('the home page wires it the only way that keeps the text', () => {
  const index = readFileSync(join(__dirname, '..', 'src/pages/index.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('mounts the panel unconditionally and passes the open state as a prop', () => {
    /*
     * THE REGRESSION THIS FILE EXISTS FOR. `{showAbout && <AboutPanel …/>}` is the form every other
     * overlay on this stage uses, it looks like the tidier code, and it would delete the page's only
     * prose from the rendered DOM. The panel hides itself with `hidden` instead.
     */
    expect(index).toMatch(/<AboutPanel\s+open=\{showAbout\}/);
    expect(index).not.toMatch(/\{\s*showAbout\s*&&/);
  });

  it('publishes the SAME array it renders as FAQPage structured data', () => {
    // SeoHead turns `faq` into JSON-LD. If the page ever imported a second list for the markup, the
    // structured data would start describing questions the page does not ask.
    expect(index).toMatch(/import\s*\{[^}]*HOME_FAQ[^}]*\}\s*from\s*["']@\/components\/aboutPanel["']/);
    expect(index).toMatch(/faq=\{HOME_FAQ\}/);
    expect(index).not.toMatch(/const\s+HOME_FAQ/);
  });

  it('serves the same prose before the bundle boots', () => {
    // The `!showContent` branch is what a crawler that does not run 800kB of JS, and a visitor on a
    // slow phone, actually receive.
    expect(index).toMatch(/<AboutDocument\s*\/>/);
  });
});
