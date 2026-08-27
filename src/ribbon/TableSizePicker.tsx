import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { anchorTo } from '../ui/anchorTo';

const ROWS = 8;
const COLS = 8;

interface TableSizePickerProps {
  /** The DOM rect of the ribbon control (⊞) that opened this picker --
   *  positions it via `anchorTo`, the same helper the tooltip and the
   *  insert-link/image popover use. */
  triggerRect: DOMRect;
  onSelect: (rows: number, cols: number) => void;
  onCancel: () => void;
}

type Phase = 'measuring' | 'visible';

export function TableSizePicker({ triggerRect, onSelect, onCancel }: TableSizePickerProps) {
  const [hover, setHover] = useState({ r: 1, c: 1 });
  const [phase, setPhase] = useState<Phase>('measuring');
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => { rootRef.current?.focus(); }, []);

  // Same measure-then-position dance as InsertPopover: the picker's own size
  // depends on its rendered grid, so it's measured after mount, positioned
  // beneath `triggerRect` via the shared anchorTo helper, then revealed.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setPos(anchorTo(triggerRect, { width: box.width, height: box.height }, { width: window.innerWidth, height: window.innerHeight }));
    setPhase('visible');
  }, [triggerRect]);

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
      style={{ left: pos.left, top: pos.top, visibility: phase === 'measuring' ? 'hidden' : 'visible' }}
      onKeyDown={onKeyDown}
    >
      <div className="tsp-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
        {cells}
      </div>
      <div className="tsp-caption" aria-live="polite">{hover.r} × {hover.c}</div>
    </div>
  );
}
