/**
 * @jest-environment jsdom
 *
 * stageEscape.spec.tsx — every panel over the avatar answers the same key.
 *
 * Two of the four used to and two did not: the emote tray and the backdrop picker had no keyboard
 * dismissal at all, so the stage's answer to Escape depended on which button you had last pressed,
 * and a tray opened by accident could only be closed by finding its × with a mouse. On a screen
 * whose entire point is what is BEHIND the panels, that is the difference between a control and an
 * obstruction.
 *
 * The hook underneath carries two things that are easy to get wrong and invisible when you do — a
 * callback read off a ref, and a listener that actually goes away — so both are asserted here, on
 * the real components rather than on the hook in isolation.
 */
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { EmoteBar } from '@/components/emoteBar';
import { BackdropPicker } from '@/components/backdropPicker';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const escape = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

/** The two trays, with the props their host passes. Both unmount when dismissed. */
const TRAYS = [
  ['the emote tray', (onClose: () => void) => <EmoteBar onPlay={() => {}} onClose={onClose} />],
  [
    'the backdrop picker',
    (onClose: () => void) => <BackdropPicker activeId="" onPick={() => {}} onClose={onClose} />,
  ],
] as const;

for (const [name, render] of TRAYS) {
  describe(name, () => {
    it('closes on Escape', () => {
      const onClose = jest.fn();
      act(() => root.render(render(onClose)));
      escape();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls the LATEST onClose, not the one captured on its first render', () => {
      /*
       * The host passes an inline arrow, so this prop is a new function on every render of the stage
       * — and the stage re-renders on every chat message. A handler holding the first closure would
       * be setting state nobody is listening to any more.
       */
      const stale = jest.fn();
      const current = jest.fn();
      act(() => root.render(render(stale)));
      act(() => root.render(render(current)));
      escape();
      expect(current).toHaveBeenCalledTimes(1);
      expect(stale).not.toHaveBeenCalled();
    });

    it('stops listening once it is gone', () => {
      // The listener is on `window`. One that outlived its tray would swallow the Escape meant for
      // whichever panel is open next, for the rest of the session.
      const onClose = jest.fn();
      act(() => root.render(render(onClose)));
      act(() => root.render(<></>));
      escape();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('ignores other keys', () => {
      const onClose = jest.fn();
      act(() => root.render(render(onClose)));
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      });
      expect(onClose).not.toHaveBeenCalled();
    });
  });
}
