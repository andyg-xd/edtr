import { nestOutline } from './outlineNesting';
import type { OutlineEntry, OutlineNode } from './types';

interface OutlinePanelProps {
  entries: OutlineEntry[];
  activeIndex: number | null;
  onSelect: (entry: OutlineEntry) => void;
}

/** The document's headings; click one to jump. Navigate-only (spec D1). */
export function OutlinePanel({ entries, activeIndex, onSelect }: OutlinePanelProps) {
  if (entries.length === 0) {
    return (
      <nav className="sidebar" aria-label="Outline">
        <p className="sidebar-empty">No headings in this document</p>
      </nav>
    );
  }
  const active = activeIndex === null ? null : entries[activeIndex];
  const rows: { node: OutlineNode; depth: number }[] = [];
  const walk = (nodes: OutlineNode[], depth: number) => {
    for (const node of nodes) {
      rows.push({ node, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(nestOutline(entries), 0);

  return (
    <nav className="sidebar" aria-label="Outline">
      <ul className="sidebar-list outline-list">
        {rows.map(({ node, depth }) => {
          const isActive = active !== null && node.entry.id === active.id;
          return (
            <li key={node.entry.id} className={`outline-item${isActive ? ' is-active' : ''}`}>
              <button
                type="button"
                className="outline-select"
                style={{ ['--outline-depth' as string]: String(depth) }}
                aria-current={isActive ? 'true' : undefined}
                title={node.entry.text}
                onClick={() => onSelect(node.entry)}
              >
                {node.entry.text}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
