/**
 * @jest-environment jsdom
 *
 * stageBoundary.spec.tsx — a thrown error must not leave a blank page.
 *
 * WHAT IS ACTUALLY BEING PROTECTED. React's response to an uncaught error is to unmount the entire
 * tree, and `_error.jsx` is a SERVER error page that never sees a client-side throw. Before the
 * boundary, a WebGL failure on `/` produced an empty white document: no text, no project name, and
 * no link to /trust — on the one screen a stranger decides what this project is from.
 *
 * So the assertions here are not "an error was handled". They are: the page still says what Kamiko
 * is, the links to the verification and holder pages still work, and the offer on the page is the
 * one that can actually help. Each of those is a thing a plain five-line error boundary throws away.
 */
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { StageBoundary } from '@/components/stageBoundary';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
/** React prints every caught error to the console by design; this suite throws on purpose. */
let quiet: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  quiet.mockRestore();
});

/** A child that throws whatever it is given, on every render, until told otherwise. */
function Boom({ error, throwing = true }: { error: unknown; throwing?: boolean }) {
  if (throwing) throw error;
  return <p id="stage">the stage</p>;
}

const mount = (ui: React.ReactNode) => act(() => root.render(<StageBoundary>{ui}</StageBoundary>));
const text = () => container.textContent ?? '';
const hrefs = () => Array.from(container.querySelectorAll('a'), (a) => a.getAttribute('href'));
const button = (label: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);

describe('when nothing throws', () => {
  it('renders its children and nothing of its own', () => {
    mount(<Boom error={null} throwing={false} />);
    expect(container.querySelector('#stage')).not.toBeNull();
    expect(text()).not.toContain('The stage stopped');
  });
});

describe('when the stage throws', () => {
  it('the page still says what Kamiko is', () => {
    mount(<Boom error={new Error('THREE.WebGLRenderer: Error creating WebGL context.')} />);
    // The blank-page regression, stated positively: the project's own description is on the screen.
    expect(text()).toContain('Kamiko, the live AI VTuber');
    expect(text()).toContain('interactive 3D AI VTuber experience');
  });

  it('carries no link to a removed funnel page — the crash surface is description + FAQ, not a nav', () => {
    /*
     * The crash surface renders the same AboutProse the "what is this?" panel does. Those pages
     * (/game, /trust, /agents, /holder) were deleted — they needed a live backend + a launched mint
     * and only rendered empty states — so the boundary no longer points anywhere. What matters now
     * is that it still SAYS what the site is (asserted below), not that it links onward.
     */
    mount(<Boom error={new Error('Error creating WebGL context.')} />);
    const dead = hrefs().filter((h): h is string => h != null && ['/game', '/trust', '/agents', '/holder'].some((r) => h === r || h.startsWith(r + '/')));
    expect(dead.length ? `still links to ${dead.join(', ')}` : 'no dead links').toBe('no dead links');
  });

  it('the FAQ comes with it, so the crash page is a real page and not a stub', () => {
    mount(<Boom error={new Error('boom')} />);
    expect(text()).toContain('Do I need a wallet or an account to use Kamiko?');
  });

  it('names the cause instead of apologising', () => {
    mount(<Boom error={new Error('THREE.WebGLRenderer: Error creating WebGL context.')} />);
    expect(text()).toContain('This browser could not start the 3D stage');
    expect(text()).toMatch(/hardware acceleration/i);
  });
});

describe('the offer on the page is the one that can help', () => {
  it('a device with no WebGL is NOT offered a retry that would re-throw on click', () => {
    mount(<Boom error={'Error creating WebGL context.'} />);
    expect(button('try again')).toBeUndefined();
    expect(button('reload the page')).toBeDefined();
  });

  it('a transient failure IS offered a retry', () => {
    mount(<Boom error={new TypeError('Failed to fetch')} />);
    expect(button('try again')).toBeDefined();
  });

  it('a retry that lands puts the stage back', () => {
    mount(<Boom error={new TypeError('Failed to fetch')} throwing />);
    expect(container.querySelector('#stage')).toBeNull();

    // The child stops throwing — a reconnected network — and the press re-mounts it.
    act(() => root.render(<StageBoundary><Boom error={null} throwing={false} /></StageBoundary>));
    act(() => { button('try again')!.click(); });
    expect(container.querySelector('#stage')).not.toBeNull();
  });

  it('retries EXACTLY once, so a deterministic crash is not a loop', () => {
    /*
     * A child that throws every time is the shape of a real deterministic failure, and a retry
     * button that stays put in front of one invites somebody to press it until they conclude the
     * site is broken. After the first failed attempt only the reload remains.
     */
    mount(<Boom error={new TypeError('Failed to fetch')} />);
    expect(button('try again')).toBeDefined();

    act(() => { button('try again')!.click(); });

    expect(text()).toContain('Something she needed did not load');
    expect(button('try again')).toBeUndefined();
    expect(button('reload the page')).toBeDefined();
  });
});
