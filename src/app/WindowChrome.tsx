import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type ViewMode = 'code' | 'live';

interface WindowChromeProps {
  name: string | null;
  dirty: boolean;
  viewMode: ViewMode;
  onSetViewMode: (mode: ViewMode) => void;
  liveDisabled: boolean;
}

/** Top bar: filename + dirty dot + Code/Live toggle. Keeps the OS title in sync. */
export function WindowChrome({ name, dirty, viewMode, onSetViewMode, liveDisabled }: WindowChromeProps) {
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
          className={viewMode === 'code' ? 'active' : ''}
          aria-pressed={viewMode === 'code'}
          onClick={() => onSetViewMode('code')}
        >
          Code
        </button>
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
      </div>
    </header>
  );
}
