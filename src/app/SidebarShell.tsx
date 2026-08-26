import type { ReactNode } from 'react';

export type SidebarMode = 'files' | 'outline';

interface SidebarShellProps {
  /** False in a single-document window, which has no file list to show. */
  hasFiles: boolean;
  mode: SidebarMode;
  onSetMode: (mode: SidebarMode) => void;
  files: ReactNode;
  outline: ReactNode;
}

/**
 * The left column: one pane at a time, with a switch only where switching
 * means something (spec D6/D7).
 *
 * Owns which pane shows and nothing else — it builds neither pane, because
 * only the caller has the documents.
 */
export function SidebarShell({ hasFiles, mode, onSetMode, files, outline }: SidebarShellProps) {
  // With no files, "files" is not a reachable state — a window with one
  // document must never show an empty pane and no way out of it.
  const showing: SidebarMode = hasFiles ? mode : 'outline';
  return (
    <div className="sidebar-shell">
      {hasFiles && (
        <div className="sidebar-switch" role="group" aria-label="Sidebar mode">
          <button
            type="button"
            className={showing === 'files' ? 'active' : ''}
            aria-pressed={showing === 'files'}
            onClick={() => onSetMode('files')}
          >
            Files
          </button>
          <button
            type="button"
            className={showing === 'outline' ? 'active' : ''}
            aria-pressed={showing === 'outline'}
            onClick={() => onSetMode('outline')}
          >
            Outline
          </button>
        </div>
      )}
      {showing === 'files' ? files : outline}
    </div>
  );
}
