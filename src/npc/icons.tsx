/**
 * icons.tsx — the $KAMIKO clicker's vector icon set and the mascot tap-face.
 *
 * No emoji in the UI (owner rule): the tap target is the actual $KAMIKO character art, and every
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
 * NpcFace — the tappable mascot: Kamiko, the same silver-haired anime VTuber who stands on the 3D
 * stage, drawn as a polished inline-SVG bust. She is heterochromatic on purpose — the RIGHT eye is
 * always open and violet, the LEFT eye starts as a dim, closed "asleep" lash line and OPENS into a
 * glowing neon-green eye as `awake` rises. Her cheeks flush and her mouth lifts into a soft smile
 * once she is hyped, and a neon awakening halo behind her intensifies the whole way up. This whole
 * "the NPC that woke up" arc lives in one portrait, and the portrait is the tap target itself.
 */
export function NpcFace({ awake }: { awake: number }) {
  const a = Math.max(0, Math.min(100, awake)) / 100;
  const leftAwake = awake >= 45; // the asleep eye opens
  const hyped = awake >= 85; // soft smile + full glow
  const eyeOpen = Math.max(0, Math.min(1, (awake - 45) / 40)); // 0 -> 1 as the left eye wakes

  return (
    <svg viewBox="0 0 512 512" role="img" aria-label="Kamiko — tap to wake her">
      <defs>
        <radialGradient id="kamiHalo" cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="#00ffa3" stopOpacity="0.9" />
          <stop offset="55%" stopColor="#8b5cf6" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="kamiHair" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e7e7f4" />
          <stop offset="55%" stopColor="#c3c3dd" />
          <stop offset="100%" stopColor="#9a9ac0" />
        </linearGradient>
        <linearGradient id="kamiHairShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#b7b7d6" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.65" />
        </linearGradient>
        <linearGradient id="kamiSkin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe7db" />
          <stop offset="100%" stopColor="#f6cdbc" />
        </linearGradient>
        <radialGradient id="kamiGreen" cx="42%" cy="34%" r="72%">
          <stop offset="0%" stopColor="#c6fff0" />
          <stop offset="42%" stopColor="#00ffa3" />
          <stop offset="100%" stopColor="#00b478" />
        </radialGradient>
        <radialGradient id="kamiViolet" cx="42%" cy="34%" r="72%">
          <stop offset="0%" stopColor="#e6dcff" />
          <stop offset="42%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#5b32c0" />
        </radialGradient>
        <filter id="npcGlow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="8" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* awakening halo, brighter as she wakes */}
      <circle cx="256" cy="212" r="200" fill="url(#kamiHalo)" opacity={0.18 + a * 0.5} />

      {/* hair — back layer framing the bust */}
      <path
        d="M256 78 C158 78 120 168 120 262 C120 344 132 404 150 452 L200 452 C176 402 168 344 172 288 C150 300 138 292 140 268 C160 176 196 128 256 128 C316 128 352 176 372 268 C374 292 362 300 340 288 C344 344 336 402 312 452 L362 452 C380 404 392 344 392 262 C392 168 354 78 256 78 Z"
        fill="url(#kamiHair)"
        stroke="#8b5cf6"
        strokeOpacity={0.25 + a * 0.4}
        strokeWidth="3"
      />

      {/* neck + shoulders */}
      <path d="M226 328 h60 v40 c34 8 58 30 66 84 H160 c8 -54 32 -76 66 -84 Z" fill="url(#kamiSkin)" />
      <path d="M160 452 c8 -54 32 -76 66 -84 v-6 h60 v6 c34 8 58 30 66 84 Z" fill="#12122a" opacity="0.0" />

      {/* face */}
      <path
        d="M256 150 C312 150 344 192 344 244 C344 306 306 360 256 360 C206 360 168 306 168 244 C168 192 200 150 256 150 Z"
        fill="url(#kamiSkin)"
      />

      {/* soft face shading on the right side */}
      <path d="M330 220 C342 250 336 300 300 340 C332 300 336 258 322 224 Z" fill="#e9b6a2" opacity="0.5" />

      {/* blush — flushes as she wakes */}
      <ellipse cx="206" cy="292" rx="20" ry="11" fill="#ff7eb6" opacity={0.28 + a * 0.35} />
      <ellipse cx="306" cy="292" rx="20" ry="11" fill="#ff7eb6" opacity={0.28 + a * 0.35} />

      {/* front hair / bangs framing the face */}
      <path
        d="M168 250 C160 176 200 120 256 120 C312 120 352 176 344 250 C332 206 312 188 296 214 C288 180 272 172 256 172 C240 172 224 180 216 214 C200 188 180 206 168 250 Z"
        fill="url(#kamiHair)"
      />
      <path d="M256 122 c22 -6 40 6 44 24 c-16 -10 -30 -8 -44 -2 Z" fill="url(#kamiHairShade)" opacity="0.85" />
      {/* ahoge — the little cute strand */}
      <path
        d="M256 96 c14 -20 34 -20 46 -8 c-16 -2 -26 4 -30 16"
        fill="none"
        stroke="url(#kamiHair)"
        strokeWidth="8"
        strokeLinecap="round"
      />

      {/* eyebrows */}
      <path d="M188 224 q22 -12 44 -4" fill="none" stroke="#b1b1cf" strokeWidth="6" strokeLinecap="round" />
      <path d="M280 220 q22 -8 44 4" fill="none" stroke="#b1b1cf" strokeWidth="6" strokeLinecap="round" />

      {/* RIGHT eye — always open, violet (the heterochromatic partner) */}
      <ellipse cx="300" cy="256" rx="26" ry="30" fill="#f4fbff" />
      <ellipse cx="302" cy="258" rx="18" ry="22" fill="url(#kamiViolet)" filter="url(#npcGlow)" />
      <circle cx="302" cy="260" r="8" fill="#1a1030" />
      <circle cx="295" cy="250" r="6" fill="#ffffff" opacity="0.95" />
      <path d="M272 236 q28 -12 54 2" fill="none" stroke="#3a2c1f" strokeWidth="7" strokeLinecap="round" />

      {/* LEFT eye — asleep lash line that OPENS into a glowing neon-green eye as she wakes */}
      {leftAwake ? (
        <g opacity={0.35 + eyeOpen * 0.65}>
          <ellipse cx="212" cy="256" rx="26" ry={12 + eyeOpen * 18} fill="#f4fbff" />
          <ellipse
            cx="210"
            cy="258"
            rx="18"
            ry={Math.max(8, 8 + eyeOpen * 14)}
            fill="url(#kamiGreen)"
            filter="url(#npcGlow)"
          />
          <circle cx="210" cy="260" r={4 + eyeOpen * 4} fill="#08281d" />
          <circle cx="203" cy="250" r="6" fill="#ffffff" opacity="0.95" />
          <path d="M186 236 q28 -12 54 2" fill="none" stroke="#3a2c1f" strokeWidth="7" strokeLinecap="round" />
        </g>
      ) : (
        <>
          <path d="M186 258 q26 16 52 0" fill="none" stroke="#3a2c1f" strokeWidth="7" strokeLinecap="round" />
          <path d="M190 266 l-6 8 M212 270 l0 9 M234 266 l6 8" stroke="#3a2c1f" strokeWidth="4" strokeLinecap="round" />
        </>
      )}

      {/* nose hint */}
      <path d="M254 288 q6 6 0 12" fill="none" stroke="#e0a894" strokeWidth="4" strokeLinecap="round" />

      {/* mouth — soft neutral -> gentle smile when hyped */}
      {hyped ? (
        <path d="M232 320 q24 26 48 0 q-24 10 -48 0 Z" fill="#c94b6e" stroke="#a83354" strokeWidth="3" />
      ) : (
        <path d="M240 322 q16 10 32 0" fill="none" stroke="#c05b74" strokeWidth="6" strokeLinecap="round" />
      )}

      {/* neon awakening accent — a small status spark that lifts with awakeness */}
      <circle cx="256" cy="118" r={3 + a * 3} fill="#00ffa3" opacity={0.4 + a * 0.6} filter="url(#npcGlow)" />
    </svg>
  );
}
