import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ThemeControl } from './ThemeControl';
import { ModeControls } from '../writingmodes/ModeControls';
import type { ThemeMode } from '../settings/theme';
import type { WritingMode, WritingModes } from '../settings/writingModes';

export type ViewMode = 'code' | 'live';

interface WindowChromeProps {
  name: string | null;
  dirty: boolean;
  viewMode: ViewMode;
  onSetViewMode: (mode: ViewMode) => void;
  liveDisabled: boolean;
  themeMode: ThemeMode;
  onSetThemeMode: (mode: ThemeMode) => void;
  writingModes: WritingModes;
  onSetWritingMode: (mode: WritingMode, on: boolean) => void;
}

/** Top bar: filename + dirty dot + Live/Code toggle + writing-mode toggles + theme control. Keeps the OS title in sync. */
export function WindowChrome({
  name,
  dirty,
  viewMode,
  onSetViewMode,
  liveDisabled,
  themeMode,
  onSetThemeMode,
  writingModes,
  onSetWritingMode,
}: WindowChromeProps) {
  useEffect(() => {
    const title = name ? `${dirty ? '• ' : ''}${name}` : 'Edtr';
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [name, dirty]);

  return (
    <header className="window-chrome">
      <span className="doc-name">{name ?? 'No file open'}</span>
      {dirty && (
        <span className="dirty-dot" aria-label="Unsaved changes" title="Unsaved changes">
          {'●'}
        </span>
      )}
      <span className="chrome-spacer" />
      <div className="view-toggle" role="group" aria-label="View mode">
        <button
          type="button"
          className={viewMode === 'live' ? 'active' : ''}
          aria-pressed={viewMode === 'live'}
          disabled={liveDisabled}
          title={liveDisabled ? "Live view isn't available for this file" : undefined}
          onClick={() => onSetViewMode('live')}
        >
          Live
        </button>
        <button
          type="button"
          className={viewMode === 'code' ? 'active' : ''}
          aria-pressed={viewMode === 'code'}
          onClick={() => onSetViewMode('code')}
        >
          Code
        </button>
      </div>
      <ModeControls modes={writingModes} onSetMode={onSetWritingMode} />
      <ThemeControl mode={themeMode} onSetMode={onSetThemeMode} />
    </header>
  );
}
