/**
 * aboutPanel.tsx — what this is, in the stage's own voice.
 *
 * WHY THIS FILE EXISTS, and it is a reported bug rather than a refactor.
 *
 * `/` is a WebGL canvas. A canvas carries no indexable text and announces nothing to a screen
 * reader, so the page has always needed a prose description of itself somewhere in the DOM — and
 * that prose is also what makes the FAQPage JSON-LD in seoHead.tsx a truthful claim rather than
 * structured data for content the visitor cannot reach.
 *
 * It used to be met by a bordered card pinned over the avatar at `bottom-24 right-3`, and it was
 * the first thing anybody said about this UI, unprompted: it looked bolted on, and everything in
 * it left the stage. Three separate faults, worth naming because the fix for each is different:
 *
 *   1. IT SPOKE A DIFFERENT LANGUAGE. Every other panel on this stage is the same material —
 *      `bg-black/70` smoked glass, `backdrop-blur-sm`, `rounded-2xl`, NO border, labels at
 *      `text-[10px] uppercase tracking-widest` on white at 50-60%, body text as white at an
 *      opacity rather than a grey (emoteBar, backdropPicker, tapToWake). The card was
 *      `border border-slate-700 bg-slate-950/90 shadow-xl` with a row of emerald underlined
 *      links. Nothing about it was wrong in isolation; it just was not from here.
 *   2. IT SAT ON THE TAP PANEL. `bottom-24 right-3` overlaps `bottom-20 right-4`, so opening the
 *      clicker stacked two dark cards on each other in the same corner.
 *   3. EVERY LINK WAS AN EXIT. Four of them, including "the tap-to-wake game" pointing at /game —
 *      a route with no avatar on it, when the game has been ON this screen the whole time. The
 *      link took you away from the game in order to reach the game.
 *
 * THE SHAPE OF THE FIX. The stage already has a pattern for "a thing you reach for while watching
 * her": a button on the menu rail opens a tray that hangs off the furniture it belongs to. The
 * emote and backdrop trays hang off the top-RIGHT furniture (the market HUD). This hangs off the
 * top-LEFT furniture — the menu rail itself — which is the structural answer to "bolted on": it is
 * not floating anywhere, it is a spur off the control it opened from, and the emerald hairline down
 * its left edge is the join. That rule is the only accent in the panel; everything else is the
 * stage's own white-on-glass, because a second accent is what made the old card shout.
 *
 * There is no entrance animation, deliberately. The stage has no motion vocabulary — the trays
 * simply appear — and one bespoke keyframe here would be the only animated thing on the screen.
 *
 * IT IS MOUNTED WHETHER OR NOT IT IS OPEN, and that is the SEO requirement, not a React habit.
 * Closed, it is `hidden`: present in the served HTML and in the rendered DOM, not painted. That is
 * the same posture the old `<details>` had — a collapsed disclosure's content is in the DOM and
 * unpainted too — so nothing about how this page indexes has changed. Rendering it behind `&&`
 * instead would delete the page's only prose from the DOM the moment the stage hydrates, which is
 * the regression this comment exists to stop somebody shipping as a "cleanup".
 */
import { useEffect, useRef } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

import { useEscapeToClose } from '@/features/stage/useEscapeToClose';

/**
 * The FAQ, rendered AND published as JSON-LD (index.tsx hands this same array to SeoHead).
 *
 * One array, two consumers, on purpose: Google's FAQPage guidance is that the questions and
 * answers have to be on the page the markup describes. Two copies would let the markup and the
 * page drift apart, and the copy that drifts is the one nobody is looking at — which in this case
 * is structured data claiming content that is not there.
 */
export const HOME_FAQ = [
  {
    question: 'What is Kamiko?',
    answer: 'Kamiko is an interactive 3D AI VTuber you can talk to in your browser, with chat, voice, and a tap-to-wake game.',
  },
  {
    question: 'Do I need a wallet or an account to use Kamiko?',
    answer: 'No. Kamiko runs entirely in your browser — just open the page and start talking. Nothing is required to explore her.',
  },
] as const;

/** The stage's label register: the 10px wide-tracked eyebrow tapToWake sets over every block. */
const EYEBROW = 'text-[10px] uppercase tracking-widest text-white/50';

/** A standalone label — the panel's own caption, which heads no section. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className={EYEBROW}>{children}</div>;
}

/**
 * A section heading, wearing the eyebrow.
 *
 * It LOOKS like a label and IS an `<h2>`: this prose is the only outline `/` has, so a screen
 * reader jumping by heading is how somebody navigates a page whose visible content is a canvas.
 * The style goes on the heading itself rather than on a wrapper around it — a div whose only job
 * is to hold a class is a node in the accessibility tree that means nothing.
 */
function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className={EYEBROW}>{children}</h2>;
}

/**
 * THE PROSE ITSELF, written once.
 *
 * Three surfaces render this: the panel on the stage, the pre-hydration document that a crawler and
 * a no-JS visitor get, and the crash surface an error boundary puts up when the stage cannot draw
 * (components/stageBoundary.tsx — the one screen where "what is this site?" is the ONLY question
 * the visitor has left, and where a generic apology would be the whole page). No two of them are
 * ever mounted at once — index.tsx returns the document early while `showContent` is false, and the
 * boundary renders instead of its children — so the ids in here stay unique at runtime.
 *
 * The headings are the stage's eyebrows rather than a document's `<h2>`s to look at, but they ARE
 * `<h2>`s, because this is the page's only outline and a screen reader on a WebGL canvas has
 * nothing else to navigate by.
 */
export function AboutProse() {
  return (
    <>
      <h1 id="kamiko-heading" className="text-lg font-semibold tracking-tight text-white">
        Kamiko, the live AI VTuber
      </h1>

      <section className="mt-4" aria-labelledby="kamiko-who">
        <SectionHeading id="kamiko-who">who she is</SectionHeading>
        <p className="mt-1.5 text-xs leading-relaxed text-white/85">
          Kamiko is an interactive 3D AI VTuber experience. This screen is the whole thing: a live
          avatar, chat, voice, and a tap-to-wake panel in one browser stage. The menu on the left
          changes how she looks and sounds and opens the chat history — no wallet or sign-up needed.
        </p>
      </section>

      <section className="mt-4 border-t border-white/15 pt-3" aria-labelledby="kamiko-do">
        <SectionHeading id="kamiko-do">what you can do here</SectionHeading>
        <p className="mt-1.5 text-xs leading-relaxed text-white/85">
          Talk to her by chat or voice, and she talks back in character. The tap-to-wake game runs on
          this screen too, in a panel over the avatar: it counts your taps and changes her mood. React
          with emotes or change the backdrop from the same menu.
        </p>
      </section>

      <section className="mt-4 border-t border-white/15 pt-3" aria-labelledby="kamiko-faq-heading">
        <SectionHeading id="kamiko-faq-heading">questions</SectionHeading>
        <dl className="mt-1.5 space-y-2.5">
          {HOME_FAQ.map(({ question, answer }) => (
            <div key={question}>
              <dt className="text-xs font-semibold text-white">{question}</dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-white/85">{answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-4 border-t border-white/15 pt-3" aria-labelledby="kamiko-more-heading">
        <SectionHeading id="kamiko-more-heading">read more</SectionHeading>
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <li><a href="/about" className="text-emerald-300 hover:text-emerald-200">about</a></li>
          <li><a href="/how-it-works" className="text-emerald-300 hover:text-emerald-200">how it works</a></li>
          <li><a href="/token" className="text-emerald-300 hover:text-emerald-200">$KAMIKO token</a></li>
          <li><a href="/faq" className="text-emerald-300 hover:text-emerald-200">faq</a></li>
          <li><a href="/changelog" className="text-emerald-300 hover:text-emerald-200">changelog</a></li>
        </ul>
      </section>
    </>
  );
}

/**
 * THE SAME PROSE, RE-SCALED — not a second copy of it.
 *
 * AboutProse is typeset for a 326px column beside the menu rail: `text-xs` body, a `text-lg` title.
 * Those sizes in a 672px document are unreadable in the other direction. Descendant variants re-set
 * the scale for a full-width surface, so the text itself still has exactly one home.
 *
 * Exported because the crash surface is the second full-width surface that renders this prose, and
 * a hand-copied class string is how two surfaces that are supposed to match stop matching.
 */
export const DOCUMENT_SCALE =
  '[&_dd]:text-sm [&_dt]:text-sm [&_h1]:text-3xl [&_p]:text-sm [&_section]:mt-6 [&_section]:pt-4';

export interface AboutPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * AboutPanel — the stage surface. Hangs off the menu rail it was opened from.
 *
 * THE GEOMETRY IS MEASURED, not guessed. The rail is `m-2` (8px) + `p-1` (4px) + a 28px icon +
 * 4px, so it ends at 44px; `left-12` puts the panel's emerald edge 4px off it, which is close
 * enough to read as a join and far enough not to crowd the icons. `top-2` is the rail's own margin,
 * so the two line up at the top.
 *
 * Width and height are capped against the viewport rather than fixed: `100dvh` (not `100vh`) so an
 * iOS toolbar cannot push the last line under the chrome, and on a 390px phone this is a 326px
 * column beside the rail that scrolls inside itself — the same bargain the emote tray makes on the
 * other side.
 */
export function AboutPanel({ open, onClose }: AboutPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  /*
   * Escape dismisses it — the one gesture every panel on this stage answers.
   *
   * `open` is passed as the active gate rather than left at the default because this panel is the
   * one that does NOT unmount when it closes (its prose has to stay in the DOM), so without the gate
   * it would go on swallowing Escape for the rest of the session. The hook is also where the reason
   * the callback is read off a ref is written down; it applies here more than anywhere, because the
   * focus effect below used to be fused to that listener and re-ran with it.
   */
  useEscapeToClose(onClose, open);

  /*
   * Focus moves in when it opens, and goes BACK when it closes.
   *
   * The first for the reason tapToWake does it: this floats over the avatar, and focus lands on the
   * close button so the first Tab is inside the panel rather than back down the menu rail behind it.
   *
   * The second is the half that is easy to forget and the one a keyboard user actually feels. The
   * panel does not unmount when it closes — it goes `hidden` — so without this, focus stays on a
   * button inside a `display:none` subtree, the browser drops it to `<body>`, and the next Tab
   * starts from the top of the document instead of from the menu rail the visitor was on. Restoring
   * the opener puts them back on the button they pressed, which is where they were.
   *
   * IT DEPENDS ON `open` ALONE. The host passes an inline arrow, a new identity on every render of
   * the stage — and the stage re-renders on every chat message. Any callback in this dependency
   * array re-runs the effect on each of those, and `closeRef.current?.focus()` fires again while the
   * panel is merely sitting OPEN: start typing in the chat box and the caret is yanked back to the ×
   * the moment she replies. That shipped once.
   */
  useEffect(() => {
    if (!open) return;
    const opener = typeof document === 'undefined' ? null : document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);

  return (
    /*
      `hidden`, NOT `open && <div/>`. See the file header: this prose is the page's only text, and
      unmounting it would take it out of the rendered DOM that indexes the page.
    */
    <div
      hidden={!open}
      role="region"
      aria-labelledby="kamiko-heading"
      /*
       * THE `display` UTILITY IS CONDITIONAL, AND THE `hidden` ATTRIBUTE ALONE IS NOT ENOUGH.
       *
       * This shipped broken for one build and a screenshot of the real stage is what caught it: the
       * panel was on screen, full height, before anybody pressed anything. `hidden` sets
       * `display:none` through a stylesheet rule — Tailwind's preflight carries `[hidden]{display:
       * none}` in its BASE layer — and `.flex{display:flex}` lives in the UTILITIES layer, later in
       * the same file, at the same specificity. Later wins. The attribute was there, the element was
       * announced as hidden, and it was painted anyway.
       *
       * So the display utility itself has to switch. The attribute stays because it is what tells
       * assistive tech the subtree is not part of the page; the class is what actually hides it.
       */
      className={
        'fixed left-12 top-2 z-20 max-h-[calc(100dvh-1rem)] w-[min(21rem,calc(100vw-4rem))] flex-col overflow-hidden rounded-2xl bg-black/70 backdrop-blur-sm ' +
        (open ? 'flex' : 'hidden')
      }
    >
      {/*
        THE SIGNATURE, and the only accent in here: a hairline down the edge facing the menu rail,
        so the panel reads as a spur off the button that opened it rather than a card that happens
        to be nearby. It fades downward, so the join is brightest where the two actually meet.

        It is a sibling of the scroll container, not a child of it: inside, `inset-y-0` would resolve
        against the CONTENT height and scroll away with the text, leaving the join undrawn on exactly
        the long FAQ that makes the panel scroll in the first place. Out here it spans the panel.

        Full-strength emerald at the top, not 80%: at 1px over smoked glass the first version was
        invisible on a desktop screenshot, which is a signature that is not signing anything. The
        fade still carries it to nothing by the bottom, so it reads as a join and not as a border.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-px bg-gradient-to-b from-emerald-300 via-emerald-300/30 to-transparent"
      />

      {/*
        THE EDGE SAYS THERE IS MORE.
        This panel overflows on almost every viewport — at 1440x900 the FAQ alone runs past the
        bottom — and without this the last line is sliced mid-word at the rounded corner and reads
        as a rendering bug rather than as a scroll. The `pb-8` below is the other half: it puts a
        band of empty glass after the final line, so when you HAVE scrolled to the end the fade sits
        over blank space instead of promising a line that is not there.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 rounded-b-2xl bg-gradient-to-t from-black/80 to-transparent"
      />
      <div className="overflow-y-auto overscroll-contain p-4 pb-8">
        <div className="flex items-start justify-between gap-2">
          <Eyebrow>what is this?</Eyebrow>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="close what is this"
            className="-mr-1 -mt-1 rounded p-1 text-white/50 hover:text-white focus-visible:text-white"
          >
            <XMarkIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-2">
          <AboutProse />
        </div>
      </div>
    </div>
  );
}

/**
 * AboutDocument — the pre-hydration page.
 *
 * index.tsx renders this instead of the stage until `showContent` flips, so it is what lands in the
 * static HTML and what a visitor sees for the moment before ~800kB of bundle boots. It is a plain
 * centred column: no glass, no rail, because there is no stage behind it yet to belong to.
 */
export function AboutDocument() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <Eyebrow>loading the stage</Eyebrow>
      {/*
        AND THE ONE CASE WHERE THAT LINE IS A LIE.
        For a visitor with JavaScript off this is not a boot screen, it is the page — the stage never
        arrives and "loading the stage" sits there forever. `<noscript>` is the only thing that can
        tell those two apart without JavaScript, which is the whole point.
      */}
      <noscript>
        <p className="mt-1 text-xs text-white/50">
          The 3D stage needs JavaScript. What you can read below is the whole of the text version.
        </p>
      </noscript>
      {/* The same prose, re-scaled for a document column. See DOCUMENT_SCALE. */}
      <div className={'mt-6 ' + DOCUMENT_SCALE}>
        <AboutProse />
      </div>
    </div>
  );
}

export default AboutPanel;
