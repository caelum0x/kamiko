/**
 * @jest-environment jsdom
 *
 * aboutPanelFocus.spec.tsx — the keyboard half of the about panel.
 *
 * aboutPanel.spec.tsx renders on the server and asserts what is in the HTML. Nothing there can see
 * focus, and focus is where both of this component's real bugs lived:
 *
 *   1. THE PANEL STOLE THE CARET BACK. The effect that moves focus onto the close button listed
 *      `onClose` in its dependencies, and the host passes an inline arrow — a new identity on every
 *      render of the stage, which re-renders on every chat message. So the effect re-ran and
 *      re-focused while the panel was merely sitting open: type in the chat box with this panel up,
 *      and the caret jumped to the × the moment she replied. It looked like the input was broken.
 *   2. FOCUS HAD NOWHERE TO GO ON THE WAY OUT. The panel does not unmount when it closes, it goes
 *      `hidden`. Focus was left on a button inside a display:none subtree, the browser dropped it to
 *      <body>, and the next Tab restarted from the top of the document instead of from the menu rail
 *      the visitor pressed the button on.
 *
 * Both are invisible to a mouse and obvious to a keyboard, which is exactly the kind of thing that
 * ships. These pin them.
 */
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AboutPanel } from '@/components/aboutPanel';

// React 18 requires this flag before it will accept `act` outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

/** The stage, reduced to the two things that matter: the menu button, and the panel it opens. */
function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      <button id="opener" aria-label="what is this?" />
      <input id="chat" />
      <AboutPanel open={open} onClose={onClose} />
    </>
  );
}

const render = (open: boolean, onClose: () => void) =>
  act(() => {
    root.render(<Harness open={open} onClose={onClose} />);
  });

const closeButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="close what is this"]');
const opener = () => container.querySelector<HTMLButtonElement>('#opener')!;
const chat = () => container.querySelector<HTMLInputElement>('#chat')!;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('opening the panel', () => {
  it('moves focus onto the close button, so the first Tab lands inside it', () => {
    render(false, () => {});
    opener().focus();
    expect(document.activeElement).toBe(opener());

    render(true, () => {});
    expect(document.activeElement).toBe(closeButton());
  });
});

describe('closing the panel', () => {
  it('gives focus back to the control that opened it', () => {
    render(false, () => {});
    opener().focus();
    render(true, () => {});
    expect(document.activeElement).toBe(closeButton());

    render(false, () => {});
    // Not <body>: the panel is `hidden`, not unmounted, so nothing would reclaim focus on its own.
    expect(document.activeElement).toBe(opener());
  });
});

describe('while the panel is open', () => {
  it('a re-render with a fresh onClose does NOT pull focus back', () => {
    /*
     * THE REGRESSION. `onClose={() => setShowAbout(false)}` is a new function on every render of the
     * host, and the host re-renders constantly. If the focus effect depends on it, this test's
     * second render re-runs it and the caret leaves the chat box.
     */
    render(false, () => {});
    opener().focus();
    render(true, () => {});

    chat().focus();
    expect(document.activeElement).toBe(chat());

    // A new arrow, exactly as the host passes one on each of its own renders.
    render(true, () => {});
    expect(document.activeElement).toBe(chat());
  });

  it('Escape calls the LATEST onClose, not the one captured when it opened', () => {
    // The flip side of reading the callback off a ref: it must not go stale either. A panel that
    // called a closure from three renders ago would set state nobody is listening to any more.
    const stale = jest.fn();
    const current = jest.fn();

    render(false, stale);
    render(true, stale);
    render(true, current);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(current).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
  });

  it('stops listening for Escape once it is closed', () => {
    // The listener is on `window`, so a panel that never removed it would keep swallowing Escape for
    // the rest of the session — including the Escape that closes the tap panel.
    const onClose = jest.fn();
    render(false, onClose);
    render(true, onClose);
    render(false, onClose);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
