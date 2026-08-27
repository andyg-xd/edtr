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
        {/*
          A side-panel mark rather than a hamburger (owner, 2026-08-27): the
          hamburger is a web and mobile convention and says "menu", not "panel".
          This says what the control does — a pane hinged off the left edge of
          a window — which is the same idea Teams, VS Code and Finder use.

          Inline rather than an icon component or a font: it is the only icon
          in the app, and inventing an icon system for one glyph is the kind of
          scope this project exists not to add. Extract it when a second one
          turns up, not before.

          `currentColor` throughout, so it inherits .sidebar-toggle's existing
          rest / hover / pressed colours and needs no colour of its own — which
          also keeps every literal colour inside tokens.css, as tokens.test.ts
          requires.

          aria-hidden because the accessible name comes from the button's
          aria-label. There is no text content any more, so that label is now
          load-bearing; a test below pins it.
        */}
        <svg
          className="sidebar-toggle-icon"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="1.75" y="3" width="12.5" height="10" rx="2.25" />
          <line x1="6.25" y1="3" x2="6.25" y2="13" />
          <line x1="3.6" y1="6.1" x2="4.9" y2="6.1" strokeWidth="1" />
          <line x1="3.6" y1="8" x2="4.9" y2="8" strokeWidth="1" />
          <line x1="3.6" y1="9.9" x2="4.9" y2="9.9" strokeWidth="1" />
        </svg>
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
