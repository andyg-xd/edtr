import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import { liveSchema } from '../views/liveSchema';

const { table, tableCell } = liveSchema.nodes;

export interface TableContext {
  table: PMNode;
  tableDepth: number;
  /** $from.start(tableDepth): position of the first row's open token. */
  tableStart: number;
  rowIndex: number;
  colIndex: number;
  /** Header row's cell count (all GFM rows are equal-width). */
  colCount: number;
}

/**
 * Locate the table enclosing `$from`. Walks up for the `tableCell`, then walks
 * up for the `table` node TYPE (not by fixed depth subtraction) — hardens the
 * old `tableDepth = depth - 2`. Returns null when not inside a table cell.
 */
export function findTable($from: ResolvedPos): TableContext | null {
  let cellDepth = $from.depth;
  while (cellDepth > 0 && $from.node(cellDepth).type !== tableCell) cellDepth--;
  if (cellDepth === 0) return null;
  let tableDepth = cellDepth - 1;
  while (tableDepth > 0 && $from.node(tableDepth).type !== table) tableDepth--;
  if (tableDepth === 0) return null; // a table is always nested under doc, never at depth 0
  const tableNode = $from.node(tableDepth);
  return {
    table: tableNode,
    tableDepth,
    tableStart: $from.start(tableDepth),
    rowIndex: $from.index(tableDepth),
    colIndex: $from.index(tableDepth + 1),
    colCount: tableNode.child(0).childCount,
  };
}

export function isInTable(state: EditorState): boolean {
  return findTable(state.selection.$from) !== null;
}

/**
 * Move the cursor to the next (dir=1) or previous (dir=-1) table cell, row-major.
 * Returns false when not inside a table cell (so Tab behaves normally elsewhere);
 * a no-op that consumes the key at the table's last/first cell.
 * (Tab-at-last-cell → new row is added in Task 6.)
 */
export function goToNextCell(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const ctx = findTable(state.selection.$from);
    if (!ctx) return false;
    const cellStarts: number[] = [];
    let pos = ctx.tableStart;
    ctx.table.forEach((row) => {
      let rpos = pos + 1;
      row.forEach((cell) => { cellStarts.push(rpos + 1); rpos += cell.nodeSize; });
      pos += row.nodeSize;
    });
    // Current cell's row-major index from ctx.
    let idx = 0;
    for (let r = 0; r < ctx.rowIndex; r++) idx += ctx.table.child(r).childCount;
    idx += ctx.colIndex;
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= cellStarts.length) return true; // no-op at ends, consume key
    if (dispatch) {
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, cellStarts[targetIdx])).scrollIntoView());
    }
    return true;
  };
}

/**
 * Move the cursor to the cell directly above/below in the SAME COLUMN.
 * Deterministic grid nav (no view.endOfTextblock gate — it was WKWebView-flaky).
 * Returns false when not in a table, or at the table's top/bottom edge (so
 * Up/Down can exit the table via default motion).
 */
export function arrowVertical(dir: 'up' | 'down'): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (!sel.empty) return false;
    const ctx = findTable(sel.$from);
    if (!ctx) return false;
    const targetRowIndex = ctx.rowIndex + (dir === 'down' ? 1 : -1);
    if (targetRowIndex < 0 || targetRowIndex >= ctx.table.childCount) return false; // exit table
    const targetRow = ctx.table.child(targetRowIndex);
    if (ctx.colIndex >= targetRow.childCount) return false; // ragged safety
    let pos = ctx.tableStart;
    for (let r = 0; r < targetRowIndex; r++) pos += ctx.table.child(r).nodeSize;
    pos += 1; // into target row
    for (let c = 0; c < ctx.colIndex; c++) pos += targetRow.child(c).nodeSize;
    pos += 1; // into target cell (content start)
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)).scrollIntoView());
    return true;
  };
}
