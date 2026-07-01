import { useEffect, useRef, useState } from 'react';

const ROWS = 8;
const COLS = 8;

interface TableSizePickerProps {
  onSelect: (rows: number, cols: number) => void;
  onCancel: () => void;
}

export function TableSizePicker({ onSelect, onCancel }: TableSizePickerProps) {
  const [hover, setHover] = useState({ r: 1, c: 1 });
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => { rootRef.current?.focus(); }, []);

  // Use native mouseenter on the grid to capture mouseenter events dispatched by tests
  // (React delegates onMouseEnter via mouseover, but tests dispatch native mouseenter)
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    function onMouseEnterCell(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const r = Number(target.dataset.r);
      const c = Number(target.dataset.c);
      if (r && c) setHover({ r, c });
    }
    grid.addEventListener('mouseenter', onMouseEnterCell, true);
    return () => grid.removeEventListener('mouseenter', onMouseEnterCell, true);
  }, []);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onCancel();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [onCancel]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); return; }
    if (e.key === 'Enter') { e.preventDefault(); onSelect(hover.r, hover.c); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); setHover((h) => ({ ...h, c: Math.min(COLS, h.c + 1) })); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setHover((h) => ({ ...h, c: Math.max(1, h.c - 1) })); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHover((h) => ({ ...h, r: Math.min(ROWS, h.r + 1) })); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHover((h) => ({ ...h, r: Math.max(1, h.r - 1) })); }
  }

  const cells = [];
  for (let r = 1; r <= ROWS; r++) {
    for (let c = 1; c <= COLS; c++) {
      const on = r <= hover.r && c <= hover.c;
      cells.push(
        <div
          key={`${r}-${c}`}
          className={`tsp-cell${on ? ' tsp-on' : ''}`}
          role="gridcell"
          aria-selected={on}
          data-r={r}
          data-c={c}
          onMouseEnter={() => setHover({ r, c })}
          onMouseDown={(e) => { e.preventDefault(); onSelect(r, c); }}
        />,
      );
    }
  }

  return (
    <div
      ref={rootRef}
      className="table-size-picker"
      role="dialog"
      aria-label="Insert table"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div ref={gridRef} className="tsp-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
        {cells}
      </div>
      <div className="tsp-caption" aria-live="polite">{hover.r} × {hover.c}</div>
    </div>
  );
}
