/**
 * backdropPicker.tsx — change the stage, from the stage.
 *
 * The three background settings pages (image, colour, video) still exist and still do more than
 * this does — a file upload, the full colour wheel, a YouTube id. What they cannot be is the thing
 * a visitor finds: they are behind the wrench, inside a menu list, one per kind. This is the ten
 * bundled scenes and six solid backdrops, one press away, on the screen she is standing on.
 *
 * It renders `BACKDROPS` and calls back; the host writes the config and repaints (one place decides
 * how a backdrop is applied — features/stage/background.ts).
 */
import { XMarkIcon } from '@heroicons/react/24/outline';

import { BACKDROPS, type Backdrop } from '@/features/stage/background';
import { useEscapeToClose } from '@/features/stage/useEscapeToClose';
import { thumbPrefix } from '@/components/settings/common';

export interface BackdropPickerProps {
  /** The active backdrop's id (`activeBackdropId` of the current config). */
  activeId: string;
  onPick: (backdrop: Backdrop) => void;
  onClose: () => void;
}

export function BackdropPicker({ activeId, onPick, onClose }: BackdropPickerProps) {
  // Escape, the same as every other panel on this stage. See features/stage/useEscapeToClose.ts.
  useEscapeToClose(onClose);

  return (
    <div className="pointer-events-auto flex max-h-[52vh] w-[8.5rem] flex-col rounded-2xl bg-black/70 p-2 text-white backdrop-blur-sm">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[10px] uppercase tracking-wider opacity-50">backdrop</span>
        <button onClick={onClose} aria-label="close backdrops" className="opacity-50 hover:opacity-100">
          <XMarkIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1 overflow-y-auto overscroll-contain">
        {BACKDROPS.map((backdrop) => {
          const selected = backdrop.id === activeId;
          return (
            <button
              key={backdrop.id}
              onClick={() => onPick(backdrop)}
              title={backdrop.label}
              aria-label={`background: ${backdrop.label}`}
              aria-pressed={selected}
              className={
                'flex flex-col items-center gap-0.5 rounded-lg p-1 transition-all ' +
                (selected ? 'bg-white/25 ring-1 ring-white/60' : 'bg-white/5 hover:bg-white/15')
              }
            >
              {backdrop.kind === 'image' ? (
                <img
                  src={thumbPrefix(backdrop.value)}
                  alt=""
                  width={56}
                  height={32}
                  loading="lazy"
                  className="h-8 w-full rounded object-cover"
                  /* The thumbnails are generated beside the full images; if one is missing, the
                     full image is a heavier but correct fallback rather than a broken tile. */
                  onError={(e: React.SyntheticEvent<HTMLImageElement, Event>) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = backdrop.value;
                  }}
                />
              ) : (
                <span
                  aria-hidden
                  className="h-8 w-full rounded border border-white/20"
                  style={{ backgroundColor: backdrop.value }}
                />
              )}
              <span className="w-full truncate text-center text-[9px] leading-tight opacity-70">{backdrop.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
