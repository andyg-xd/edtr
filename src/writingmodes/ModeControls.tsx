import { Tooltip } from '../ui/Tooltip';
import type { WritingMode, WritingModes } from '../settings/writingModes';

interface ModeControlsProps {
  modes: WritingModes;
  onSetMode: (mode: WritingMode, on: boolean) => void;
}

/**
 * The two writing-mode toggles, now living in the persistent document
 * toolbar (6c-iii, D9) rather than beside the theme control — see
 * `DocumentToolbar.tsx` for why.
 *
 * Labels are plain language with no phase or internal vocabulary, per the
 * project's tone rules — a reader sees "Typewriter", never "6c-ii".
 */
export function ModeControls({ modes, onSetMode }: ModeControlsProps) {
  return (
    <div className="mode-controls" role="group" aria-label="Writing modes">
      <Tooltip label="Keep the line you are typing at a fixed height" id="tip-mode-typewriter">
        <button
          type="button"
          // `ribbon-btn` alongside the existing classes, added for scale parity
          // with the other toolbar controls (6c-iii, Task 6) -- its sizing
          // rules live only in ribbon.css and must not be duplicated here.
          className={`btn btn--secondary mode-control ribbon-btn${modes.typewriter ? ' is-on' : ''}`}
          aria-pressed={modes.typewriter}
          onClick={() => onSetMode('typewriter', !modes.typewriter)}
        >
          Typewriter
        </button>
      </Tooltip>
      <Tooltip label="Dim everything except the paragraph you are in" id="tip-mode-focus">
        <button
          type="button"
          className={`btn btn--secondary mode-control ribbon-btn${modes.focus ? ' is-on' : ''}`}
          aria-pressed={modes.focus}
          onClick={() => onSetMode('focus', !modes.focus)}
        >
          Focus
        </button>
      </Tooltip>
    </div>
  );
}
