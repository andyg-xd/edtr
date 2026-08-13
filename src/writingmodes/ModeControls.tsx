import { Tooltip } from '../ui/Tooltip';
import type { WritingMode, WritingModes } from '../settings/writingModes';

interface ModeControlsProps {
  modes: WritingModes;
  onSetMode: (mode: WritingMode, on: boolean) => void;
}

/**
 * The two writing-mode toggles, sitting beside the theme control (D9).
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
          className={`btn btn--secondary mode-control${modes.typewriter ? ' is-on' : ''}`}
          aria-pressed={modes.typewriter}
          onClick={() => onSetMode('typewriter', !modes.typewriter)}
        >
          Typewriter
        </button>
      </Tooltip>
      <Tooltip label="Dim everything except the paragraph you are in" id="tip-mode-focus">
        <button
          type="button"
          className={`btn btn--secondary mode-control${modes.focus ? ' is-on' : ''}`}
          aria-pressed={modes.focus}
          onClick={() => onSetMode('focus', !modes.focus)}
        >
          Focus
        </button>
      </Tooltip>
    </div>
  );
}
