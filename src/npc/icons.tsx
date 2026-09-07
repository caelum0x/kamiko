/**
 * icons.tsx — the $NPC clicker's vector icon set and the mascot tap-face.
 *
 * No emoji in the UI (owner rule): the tap target is the actual $NPC character art, and every
 * HUD/nav glyph is a clean feather-style stroke icon that inherits the app palette through
 * `currentColor`. Keeping them here as small inline components means the game ships no emoji
 * codepoints and no icon-font dependency.
 */
import type { CSSProperties } from 'react';

interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/** Shared feather-style wrapper: 24x24 grid, round joins, stroke = currentColor. */
function Ic({ size = 16, className, style, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={'npcg-ic' + (className ? ' ' + className : '')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      {children}
    </svg>
  );
}

export const MicIcon = (p: IconProps) => (
  <Ic {...p}>
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
    <line x1="12" y1="18" x2="12" y2="22" />
  </Ic>
);

export const GemIcon = (p: IconProps) => (
  <Ic {...p}>
    <path d="M6 3h12l4 6-10 12L2 9z" />
    <path d="M2 9h20" />
    <path d="M12 21 8 9l2-6" />
    <path d="m12 21 4-12-2-6" />
  </Ic>
);

export const ShieldIcon = (p: IconProps) => (
  <Ic {...p}>
    <path d="M12 2 4 5v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V5z" />
    <path d="m9 12 2 2 4-4" />
  </Ic>
);

export const BotIcon = (p: IconProps) => (
  <Ic {...p}>
    <rect x="4" y="8" width="16" height="12" rx="2" />
    <path d="M12 8V4" />
    <circle cx="12" cy="4" r="1" />
    <line x1="9" y1="13" x2="9" y2="15" />
    <line x1="15" y1="13" x2="15" y2="15" />
  </Ic>
);

export const FlameIcon = (p: IconProps) => (
  <Ic {...p}>
    <path d="M12 2s5 3.5 5 9a5 5 0 0 1-10 0c0-1.8 1-3 1-3s0 1.8 1.8 1.8c1.4 0 1.4-1.7 1.4-3C12.2 4.7 12 2 12 2z" />
  </Ic>
);

export const ChartIcon = (p: IconProps) => (
  <Ic {...p}>
    <line x1="6" y1="20" x2="6" y2="14" />
    <line x1="12" y1="20" x2="12" y2="9" />
    <line x1="18" y1="20" x2="18" y2="4" />
  </Ic>
);

export const ShareIcon = (p: IconProps) => (
  <Ic {...p}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" />
    <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
  </Ic>
);

export const LinkIcon = (p: IconProps) => (
  <Ic {...p}>
    <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07l-1.42 1.42" />
    <path d="M14 11a5 5 0 0 0-7.07 0l-2.83 2.83a5 5 0 0 0 7.07 7.07l1.42-1.42" />
  </Ic>
);

export const BellIcon = (p: IconProps) => (
  <Ic {...p}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10 21a2 2 0 0 0 4 0" />
  </Ic>
);

export const CheckIcon = (p: IconProps) => (
  <Ic {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Ic>
);

export const GiftIcon = (p: IconProps) => (
  <Ic {...p}>
    <rect x="3" y="8" width="18" height="4" rx="1" />
    <path d="M5 12v9h14v-9" />
    <line x1="12" y1="8" x2="12" y2="21" />
    <path d="M12 8C10.5 8 8 7.5 8 5.5S10.5 4 12 8z" />
    <path d="M12 8c1.5 0 4-.5 4-2.5S13.5 4 12 8z" />
  </Ic>
);

/**
 * NpcFace — the tappable mascot. Driven by awakeness: the left eye is a flat, dim "asleep" line
 * that opens into a glowing neon eye as she wakes, and the mouth lifts once she is hyped. This is
 * the whole "the NPC that woke up" concept in one glyph, and it is the tap target itself.
 */
export function NpcFace({ awake }: { awake: number }) {
  const leftAwake = awake >= 45;
  const hyped = awake >= 85;
  return (
    <svg viewBox="0 0 512 512" role="img" aria-label="the NPC — tap to wake her">
      <defs>
        <linearGradient id="npcHead" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4a4a5c" />
          <stop offset="100%" stopColor="#2c2c3a" />
        </linearGradient>
        <filter id="npcGlow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="10" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* awakening halo, brighter as she wakes */}
      <ellipse cx="256" cy="150" rx="220" ry="130" fill="#00ffa3" opacity={0.05 + (awake / 100) * 0.16} />

      {/* blocky NPC head */}
      <rect x="140" y="150" width="232" height="232" rx="34" fill="url(#npcHead)" stroke="#1c1c2e" strokeWidth="6" />
      <rect x="140" y="150" width="232" height="46" rx="34" fill="#565669" opacity="0.5" />

      {/* left eye: asleep flat line -> glowing eye */}
      {leftAwake ? (
        <>
          <circle cx="204" cy="262" r="22" fill="#00ffa3" filter="url(#npcGlow)" />
          <circle cx="204" cy="262" r="9" fill="#eafff6" />
        </>
      ) : (
        <rect x="174" y="256" width="60" height="12" rx="6" fill="#8a8a9c" />
      )}

      {/* right eye: already woke */}
      <circle cx="308" cy="262" r="22" fill="#00ffa3" filter="url(#npcGlow)" />
      <circle cx="308" cy="262" r="9" fill="#eafff6" />

      {/* mouth: flat neutral -> slight upturn when hyped */}
      {hyped ? (
        <path d="M206 330 q50 34 100 0" stroke="#00ffa3" strokeWidth="12" strokeLinecap="round" fill="none" />
      ) : (
        <rect x="214" y="330" width="84" height="10" rx="5" fill="#20202c" />
      )}

      {/* status LED */}
      <circle cx="344" cy="196" r="7" fill="#00ffa3" opacity={hyped ? 1 : 0.75} />
    </svg>
  );
}
