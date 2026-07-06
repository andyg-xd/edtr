import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import { htmlSchema } from '../views/htmlSchema';

const { table, tableCell } = htmlSchema.nodes;

export interface TableContext {
  table: PMNode;
  tableDepth: number;
  /** $from.start(tableDepth): position just inside the table (before row 0). */
  tableStart: number;
  rowIndex: number;
  colIndex: number;
  /** First row's cell count (all rows are equal-width — the model gate rejects ragged tables). */
  colCount: number;
}

/**
 * Locate the table enclosing `$from`: walk up for the `tableCell`, then for the
 * `table` node TYPE (not fixed depth). Works with block-content cells (the
 * cursor sits inside a paragraph inside the cell). Null when not in a cell.
 */
export function findTable($from: ResolvedPos): TableContext | null {
  let cellDepth = $from.depth;
  while (cellDepth > 0 && $from.node(cellDepth).type !== tableCell) cellDepth--;
  if (cellDepth === 0) return null;
  let tableDepth = cellDepth - 1;
  while (tableDepth > 0 && $from.node(tableDepth).type !== table) tableDepth--;
  if (tableDepth === 0) return null;
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
 * Move to the next (dir=1) / previous (dir=-1) cell, row-major. Returns false
 * outside a table (Tab behaves normally elsewhere); consumes the key as a no-op
 * at the first/last cell. Cells hold block content, so land the cursor with
 * TextSelection.near (the raw cell-content position is not a text position).
 * Tab-at-last-cell → append-row is added in 4d-iv-b.
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
    let idx = 0;
    for (let r = 0; r < ctx.rowIndex; r++) idx += ctx.table.child(r).childCount;
    idx += ctx.colIndex;
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= cellStarts.length) return true; // edge: consume, no-op
    if (dispatch) {
      const sel = TextSelection.near(state.doc.resolve(cellStarts[targetIdx]));
      dispatch(state.tr.setSelection(sel).scrollIntoView());
    }
    return true;
  };
}

/**
 * Move to the cell directly above/below in the SAME column. Deterministic grid
 * nav (no view.endOfTextblock gate — WKWebView-flaky). Returns false when not
 * in a table, when the selection is non-empty, or at the top/bottom edge (so
 * the cursor can exit the table via default motion).
 */
export function arrowVertical(dir: 'up' | 'down'): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (!sel.empty) return false;
    const ctx = findTable(sel.$from);
    if (!ctx) return false;
    const targetRowIndex = ctx.rowIndex + (dir === 'down' ? 1 : -1);
    if (targetRowIndex < 0 || targetRowIndex >= ctx.table.childCount) return false;
    const targetRow = ctx.table.child(targetRowIndex);
    if (ctx.colIndex >= targetRow.childCount) return false; // ragged safety
    let pos = ctx.tableStart;
    for (let r = 0; r < targetRowIndex; r++) pos += ctx.table.child(r).nodeSize;
    pos += 1; // into target row
    for (let c = 0; c < ctx.colIndex; c++) pos += targetRow.child(c).nodeSize;
    pos += 1; // into target cell
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos))).scrollIntoView());
    return true;
  };
}
