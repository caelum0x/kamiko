/**
 * background.ts — THE STAGE SHE STANDS IN FRONT OF, and the switch that changes it.
 *
 * THE BUG THIS FIXES, first, because it is why the stage was black.
 *
 * The page has always supported two kinds of backdrop and one rule for choosing between them: a
 * non-empty `bg_color` wins, otherwise `bg_url` is drawn. Both settings pages honour that rule by
 * clearing the other key when you pick one. The DEFAULTS did not: `bg_color` shipped as `#06060b`
 * and `bg_url` as `/bg/bg-room2.jpg`, both non-empty, so the colour won on every fresh visit and the
 * ten bundled backgrounds were unreachable without going three levels into the settings menu. Every
 * visitor got near-black, forever, and the room behind her was dead code.
 *
 * The default is now the room. Ink is still one press away — it is the first swatch in `BACKDROPS`
 * and still what `NEXT_PUBLIC_BG_COLOR` sets for a deployment that wants a hero shot rather than a
 * scene — but "standard background, and let people change it" is the shipped behaviour.
 *
 * The resolution is PURE and the application is one small function over `document.body`, kept apart
 * so the rule can be tested without a DOM and so exactly one place decides it. Before this there
 * were four: `index.tsx` on mount, and each of the three settings pages writing `document.body.style`
 * inline — which is how the colour page came to leave `backgroundImage` set while it painted over it.
 */
import { bgImages } from '@/paths';

/** What is actually drawn behind her. */
export type StageBackground =
  | { kind: 'image'; url: string }
  | { kind: 'color'; color: string };

/** One entry in the on-stage picker. */
export interface Backdrop {
  /** Stable id — the config value it writes, so it doubles as the selected-state key. */
  id: string;
  label: string;
  kind: 'image' | 'color';
  /** An image path under /bg, or a CSS colour. */
  value: string;
}

/** The backdrop a fresh visit lands on: the lofi room, not the void. */
export const DEFAULT_BG_URL = '/bg/bg-room2.jpg';

/** BRAND ink — the near-black hero-shot backdrop this page used to force on everybody. */
export const INK = '#06060b';

/** Human labels for the bundled images. An image with no entry falls back to its filename. */
const IMAGE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  '/bg/bg-room2.jpg': 'lofi room',
  '/bg/bg-room1.jpg': 'neon bedroom',
  '/bg/bg-town1.jpg': 'old town',
  '/bg/bg-sunset1.jpg': 'city sunset',
  '/bg/bg-forest1.jpg': 'forest road',
  '/bg/bg-landscape1.jpg': 'blossom lake',
  '/bg/bg-landscape2.jpg': 'green hills',
  '/bg/bg-landscape3.jpg': 'lakeside',
  '/bg/bg-arbius1.jpg': 'red terminal',
  '/bg/bg-arbius2.jpg': 'blue terminal',
});

/** PURE. A filename turned into something readable, for an image the labels above do not name. */
export function labelForImage(url: string): string {
  return (
    IMAGE_LABELS[url] ??
    (url.split('/').pop() ?? url).replace(/^bg-/, '').replace(/\.(jpg|jpeg|png|webp|avif)$/i, '').replace(/[-_]+/g, ' ')
  );
}

/**
 * The solid backdrops. Deliberately few and deliberately dark-to-mid: this sits behind a rim-lit
 * character, and a saturated field behind a toon-shaded model reads as a green screen that somebody
 * forgot to key. The full colour wheel is still on the settings page for anyone who wants it.
 */
export const COLOR_BACKDROPS: readonly Backdrop[] = Object.freeze([
  { id: INK, label: 'ink', kind: 'color', value: INK },
  { id: '#101423', label: 'midnight', kind: 'color', value: '#101423' },
  { id: '#1d1b2e', label: 'plum', kind: 'color', value: '#1d1b2e' },
  { id: '#0f1f1c', label: 'pine', kind: 'color', value: '#0f1f1c' },
  { id: '#2a1a1f', label: 'wine', kind: 'color', value: '#2a1a1f' },
  { id: '#e9e4dc', label: 'paper', kind: 'color', value: '#e9e4dc' },
] as Backdrop[]);

/** Every bundled image, the default first so the picker opens on where she already is. */
export const IMAGE_BACKDROPS: readonly Backdrop[] = Object.freeze(
  [...bgImages]
    .sort((a, b) => (a === DEFAULT_BG_URL ? -1 : b === DEFAULT_BG_URL ? 1 : a.localeCompare(b)))
    .map((url): Backdrop => ({ id: url, label: labelForImage(url), kind: 'image', value: url })),
);

/** Images then colours — the order the picker renders. */
export const BACKDROPS: readonly Backdrop[] = Object.freeze([...IMAGE_BACKDROPS, ...COLOR_BACKDROPS]);

/**
 * PURE. Which backdrop the two config keys mean.
 *
 * The rule the settings pages have always written for, stated once: a colour wins when it is set,
 * an image is used when it is not, and with neither we fall back to the default image rather than
 * to a blank body — a page whose background is "whatever the browser does" is the black stage this
 * file exists to end.
 */
export function resolveBackground(bgColor: unknown, bgUrl: unknown): StageBackground {
  const color = typeof bgColor === 'string' ? bgColor.trim() : '';
  if (color !== '') return { kind: 'color', color };
  const url = typeof bgUrl === 'string' ? bgUrl.trim() : '';
  if (url !== '') return { kind: 'image', url };
  return { kind: 'image', url: DEFAULT_BG_URL };
}

/** PURE. The id of the picker entry that is currently active, for the selected state. */
export function activeBackdropId(bgColor: unknown, bgUrl: unknown): string {
  const bg = resolveBackground(bgColor, bgUrl);
  return bg.kind === 'color' ? bg.color : bg.url;
}

/**
 * Paint it. Writes BOTH properties every time — the missing half is what let a colour sit on top of
 * an image that was still loaded underneath it, so a later `transparent` revealed a backdrop nobody
 * had chosen. `background-size/position/repeat` live in globals.css and are the same either way.
 */
export function applyBackground(bg: StageBackground, body: HTMLElement | null | undefined): void {
  if (!body) return;
  if (bg.kind === 'color') {
    body.style.backgroundImage = 'none';
    body.style.backgroundColor = bg.color;
    return;
  }
  body.style.backgroundColor = 'transparent';
  body.style.backgroundImage = `url(${bg.url})`;
}
