import type { OpenDoc } from '../files/openDocuments';
import { basename } from '../files/fileTypes';

interface SidebarProps {
  docs: OpenDoc[];
  activeId: string | null;
  dirtyFor: (doc: OpenDoc) => boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

/** Left column listing the window's open documents; click to switch, × to close. */
export function Sidebar({ docs, activeId, dirtyFor, onSelect, onClose }: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="Open documents">
      <ul className="sidebar-list">
        {docs.map((doc) => {
          const isActive = doc.id === activeId;
          const name = basename(doc.session.path);
          return (
            <li key={doc.id} className={`sidebar-item${isActive ? ' is-active' : ''}`}>
              <button
                type="button"
                className="sidebar-select"
                aria-current={isActive ? 'true' : undefined}
                title={doc.session.path}
                onClick={() => onSelect(doc.id)}
              >
                {dirtyFor(doc) && <span className="sidebar-dot" aria-hidden="true">●</span>}
                <span className="sidebar-name">{name}</span>
              </button>
              <button
                type="button"
                className="sidebar-close"
                aria-label={`Close ${name}`}
                onClick={(e) => { e.stopPropagation(); onClose(doc.id); }}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
