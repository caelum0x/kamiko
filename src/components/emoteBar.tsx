/**
 * emoteBar.tsx — the on-stage emote tray.
 *
 * WHY IT IS ON THE STAGE and not in the settings menu: an emote is a thing you do WHILE watching
 * her, in the second it is funny. Anything three menu levels deep is a feature nobody uses twice.
 *
 * The tray is deliberately dumb — it renders `EMOTE_LIST` and calls back. Everything that decides
 * what an emote IS lives in features/emote/emotes.ts, so adding one is one entry in that registry
 * and no change here. It shows which emote is running only as long as the emote itself runs
 * (`holdSeconds`), which is the same clock the avatar uses, so the button and the character stop
 * agreeing about nothing.
 */
import { useEffect, useRef, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

import { EMOTE_LIST, type Emote, type EmoteId } from '@/features/emote/emotes';

export interface EmoteBarProps {
  /** Play it. The host owns the avatar; this component never touches the viewer. */
  onPlay: (emote: Emote) => void;
  onClose: () => void;
}

export function EmoteBar({ onPlay, onClose }: EmoteBarProps) {
  const [running, setRunning] = useState<EmoteId | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A press that outlives the component would call setState on an unmounted tray.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const play = (emote: Emote) => {
    onPlay(emote);
    setRunning(emote.id);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setRunning(null), Math.max(emote.holdSeconds, 0.5) * 1000);
  };

  return (
    <div className="pointer-events-auto flex max-h-[52vh] w-[8.5rem] flex-col rounded-2xl bg-black/70 p-2 text-white backdrop-blur-sm">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[10px] uppercase tracking-wider opacity-50">emotes</span>
        <button onClick={onClose} aria-label="close emotes" className="opacity-50 hover:opacity-100">
          <XMarkIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1 overflow-y-auto overscroll-contain">
        {EMOTE_LIST.map((emote) => (
          <button
            key={emote.id}
            onClick={() => play(emote)}
            title={emote.label}
            aria-label={emote.label}
            aria-pressed={running === emote.id}
            className={
              'flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 transition-colors ' +
              (running === emote.id ? 'bg-white/25' : 'bg-white/5 hover:bg-white/15 active:bg-white/25')
            }
          >
            <span aria-hidden className="text-lg leading-none">{emote.glyph}</span>
            <span className="w-full truncate text-center text-[9px] leading-tight opacity-70">{emote.id}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
