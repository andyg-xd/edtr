import type { FolderEntry } from '../files/folder';

interface FolderSidebarProps {
  entries: FolderEntry[];
  activePath: string | null;
  openPaths: Set<string>;
  dirtyForPath: (path: string) => boolean;
  onOpen: (path: string) => void;
}

/** Left column listing one folder's editable files; click to open/activate.
 * Opened files are highlighted (active) + show a dirty dot; unopened files
 * are dimmed. No close button — folder files aren't "closed", you switch away. */
export function FolderSidebar({ entries, activePath, openPaths, dirtyForPath, onOpen }: FolderSidebarProps) {
  if (entries.length === 0) {
    return (
      <nav className="sidebar" aria-label="Folder files">
        <p className="sidebar-empty">No editable files in this folder</p>
      </nav>
    );
  }
  return (
    <nav className="sidebar" aria-label="Folder files">
      <ul className="sidebar-list">
        {entries.map((entry) => {
          const isActive = entry.path === activePath;
          const isOpen = openPaths.has(entry.path);
          return (
            <li
              key={entry.path}
              className={`sidebar-item${isActive ? ' is-active' : ''}${isOpen ? '' : ' is-unopened'}`}
            >
              <button
                type="button"
                className="sidebar-select"
                aria-current={isActive ? 'true' : undefined}
                title={entry.path}
                onClick={() => onOpen(entry.path)}
              >
                {isOpen && dirtyForPath(entry.path) && (
                  <span className="sidebar-dot" aria-hidden="true">●</span>
                )}
                <span className="sidebar-name">{entry.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
