import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ThemeControl } from './ThemeControl';
import type { ThemeMode } from '../settings/theme';

export type ViewMode = 'code' | 'live';

interface WindowChromeProps {
  name: string | null;
  dirty: boolean;
  viewMode: ViewMode;
  onSetViewMode: (mode: ViewMode) => void;
  liveDisabled: boolean;
  themeMode: ThemeMode;
  onSetThemeMode: (mode: ThemeMode) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

/** Top bar: filename + dirty dot + Live/Code toggle + theme control. Keeps the OS title in sync.
 *  The writing-mode toggles moved to the persistent document toolbar (6c-iii, Task 6) — see `DocumentToolbar.tsx`. */
export function WindowChrome({
  name,
  dirty,
  viewMode,
  onSetViewMode,
  liveDisabled,
  themeMode,
  onSetThemeMode,
  sidebarOpen,
  onToggleSidebar,
}: WindowChromeProps) {
  useEffect(() => {
    const title = name ? `${dirty ? '• ' : ''}${name}` : 'Edtr';
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [name, dirty]);

  return (
    <header className="window-chrome">
      <button
        type="button"
        className="sidebar-toggle"
        aria-pressed={sidebarOpen}
        aria-label={sidebarOpen ? 'Hide outline' : 'Show outline'}
        title={sidebarOpen ? 'Hide outline' : 'Show outline'}
        onClick={onToggleSidebar}
      >
        ☰
      </button>
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
      <ThemeControl mode={themeMode} onSetMode={onSetThemeMode} />
    </header>
  );
}
