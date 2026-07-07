import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import { htmlSchema } from '../views/htmlSchema';

const { table, tableRow, tableCell, paragraph } = htmlSchema.nodes;

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
 * outside a table. Shift-Tab at the first cell consumes the key as a no-op;
 * Tab at the last cell appends an empty body row and lands in its first cell.
 * Cells hold block content, so land with TextSelection.near (the raw
 * cell-content position is not a text position).
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
    if (targetIdx < 0) return true; // Shift-Tab past the first cell: consume, no-op
    if (targetIdx >= cellStarts.length) {
      // Tab past the last cell → append an empty body row, land in its first cell.
      const rows = rowsOf(ctx.table);
      rows.push(tableRow.create(null, columnAligns(ctx.table).map((a) => emptyCell(false, a))));
      if (dispatch) dispatch(replaceTableTr(state, ctx, table.create(ctx.table.attrs, rows), rows.length - 1, 0));
      return true;
    }
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

// ---------------------------------------------------------------------------
// Shared table-mutation helpers (module-private unless noted)
// ---------------------------------------------------------------------------

type Align = 'left' | 'center' | 'right' | null;

function rowsOf(t: PMNode): PMNode[] {
  const rows: PMNode[] = [];
  for (let i = 0; i < t.childCount; i++) rows.push(t.child(i));
  return rows;
}
function cellsOf(row: PMNode): PMNode[] {
  const cells: PMNode[] = [];
  for (let i = 0; i < row.childCount; i++) cells.push(row.child(i));
  return cells;
}
/** Per-column alignment, read from row 0 (setColumnAlign sets the whole column). */
function columnAligns(t: PMNode): Align[] {
  return cellsOf(t.child(0)).map((c) => c.attrs.align as Align);
}
/** A fresh empty cell (one empty <p>, since HTML cells are block+). */
function emptyCell(header: boolean, align: Align): PMNode {
  return tableCell.create({ header, align }, paragraph.create({ htmlAttrs: {} }));
}
// exported (not yet called in this task) so header ops (Task 5) can reuse it;
// noUnusedLocals would otherwise flag it as dead code until that call site lands.
export function withHeader(cell: PMNode, header: boolean): PMNode {
  return tableCell.create({ ...cell.attrs, header }, cell.content);
}
// exported so alignment ops (Task 6) can reuse it
export function withAlign(cell: PMNode, align: Align): PMNode {
  return tableCell.create({ ...cell.attrs, align }, cell.content);
}

/** Content-start position of cell (row,col) in `t`, whose OWN open token sits at `tableFrom`. */
function cellContentPos(t: PMNode, tableFrom: number, rowIndex: number, colIndex: number): number {
  let pos = tableFrom + 1; // first row's open token
  for (let r = 0; r < rowIndex; r++) pos += t.child(r).nodeSize;
  pos += 1; // into the row
  const row = t.child(rowIndex);
  for (let c = 0; c < colIndex; c++) pos += row.child(c).nodeSize;
  return pos + 1; // into the cell content
}

/**
 * Replace the whole table (same top-level span) with `newTable`, preserving its
 * attrs (blockId/range) so dirtyTracking marks the SAME block and the reconciler
 * re-serializes it in place. Cursor → cell (row,col); TextSelection.near because
 * HTML cells hold block content (the raw cell position is not a text position).
 */
function replaceTableTr(state: EditorState, ctx: TableContext, newTable: PMNode, row: number, col: number) {
  const from = ctx.tableStart - 1; // the table node's own open token
  const to = from + ctx.table.nodeSize;
  const tr = state.tr.replaceWith(from, to, newTable);
  tr.setSelection(TextSelection.near(tr.doc.resolve(cellContentPos(newTable, from, row, col))));
  return tr.scrollIntoView();
}

// ---------------------------------------------------------------------------
// Row commands
// ---------------------------------------------------------------------------

export function addRow(dir: 'above' | 'below'): Command {
  return (state, dispatch) => {
    const ctx = findTable(state.selection.$from);
    if (!ctx) return false;
    const at = dir === 'above' ? ctx.rowIndex : ctx.rowIndex + 1;
    const newRow = tableRow.create(null, columnAligns(ctx.table).map((a) => emptyCell(false, a)));
    const rows = rowsOf(ctx.table);
    rows.splice(at, 0, newRow);
    if (dispatch) dispatch(replaceTableTr(state, ctx, table.create(ctx.table.attrs, rows), at, 0));
    return true;
  };
}

export const deleteRow: Command = (state, dispatch) => {
  const ctx = findTable(state.selection.$from);
  if (!ctx || ctx.table.childCount <= 1) return false;
  const rows = rowsOf(ctx.table);
  rows.splice(ctx.rowIndex, 1); // plain delete — HTML has no required header row
  const newTable = table.create(ctx.table.attrs, rows);
  const row = Math.min(ctx.rowIndex, newTable.childCount - 1);
  const col = Math.min(ctx.colIndex, ctx.colCount - 1);
  if (dispatch) dispatch(replaceTableTr(state, ctx, newTable, row, col));
  return true;
};
export function canDeleteRow(state: EditorState): boolean {
  const ctx = findTable(state.selection.$from);
  return !!ctx && ctx.table.childCount > 1;
}

// ---------------------------------------------------------------------------
// Column commands
// ---------------------------------------------------------------------------

/** True when every cell in the row is a header cell (a true header row). */
function rowIsHeader(row: PMNode): boolean {
  let all = row.childCount > 0;
  row.forEach((c) => { if (!c.attrs.header) all = false; });
  return all;
}

export function addColumn(dir: 'left' | 'right'): Command {
  return (state, dispatch) => {
    const ctx = findTable(state.selection.$from);
    if (!ctx) return false;
    const at = dir === 'left' ? ctx.colIndex : ctx.colIndex + 1;
    const rows = rowsOf(ctx.table).map((row) => {
      const cells = cellsOf(row);
      cells.splice(at, 0, emptyCell(rowIsHeader(row), null));
      return tableRow.create(row.attrs, cells);
    });
    if (dispatch) dispatch(replaceTableTr(state, ctx, table.create(ctx.table.attrs, rows), ctx.rowIndex, at));
    return true;
  };
}

export const deleteColumn: Command = (state, dispatch) => {
  const ctx = findTable(state.selection.$from);
  if (!ctx || ctx.colCount <= 1) return false;
  const rows = rowsOf(ctx.table).map((row) => {
    const cells = cellsOf(row);
    cells.splice(ctx.colIndex, 1);
    return tableRow.create(row.attrs, cells);
  });
  const newTable = table.create(ctx.table.attrs, rows);
  const col = Math.min(ctx.colIndex, ctx.colCount - 2);
  if (dispatch) dispatch(replaceTableTr(state, ctx, newTable, ctx.rowIndex, col));
  return true;
};
export function canDeleteColumn(state: EditorState): boolean {
  const ctx = findTable(state.selection.$from);
  return !!ctx && ctx.colCount > 1;
}

// ---------------------------------------------------------------------------
// Column alignment + header-row toggle
// ---------------------------------------------------------------------------

export function setColumnAlign(align: Align): Command {
  return (state, dispatch) => {
    const ctx = findTable(state.selection.$from);
    if (!ctx) return false;
    const rows = rowsOf(ctx.table).map((row) =>
      tableRow.create(row.attrs, cellsOf(row).map((cell, c) => (c === ctx.colIndex ? withAlign(cell, align) : cell))),
    );
    if (dispatch) dispatch(replaceTableTr(state, ctx, table.create(ctx.table.attrs, rows), ctx.rowIndex, ctx.colIndex));
    return true;
  };
}
export function getColumnAlign(state: EditorState): Align {
  const ctx = findTable(state.selection.$from);
  if (!ctx) return null;
  return ctx.table.child(0).child(ctx.colIndex).attrs.align as Align;
}

export function headerRowActive(state: EditorState): boolean {
  const ctx = findTable(state.selection.$from);
  return !!ctx && rowIsHeader(ctx.table.child(0));
}
export const toggleHeaderRow: Command = (state, dispatch) => {
  const ctx = findTable(state.selection.$from);
  if (!ctx) return false;
  const makeHeader = !rowIsHeader(ctx.table.child(0));
  const rows = rowsOf(ctx.table);
  rows[0] = tableRow.create(rows[0].attrs, cellsOf(rows[0]).map((c) => withHeader(c, makeHeader)));
  const newTable = table.create(ctx.table.attrs, rows);
  const row = Math.min(ctx.rowIndex, newTable.childCount - 1);
  const col = Math.min(ctx.colIndex, ctx.colCount - 1);
  if (dispatch) dispatch(replaceTableTr(state, ctx, newTable, row, col));
  return true;
};

export type { Align };

// ---------------------------------------------------------------------------
// Insert a new table
// ---------------------------------------------------------------------------

export function buildEmptyTable(rows: number, cols: number): PMNode {
  const rowNodes: PMNode[] = [];
  for (let r = 0; r < rows; r++) {
    const cells: PMNode[] = [];
    for (let c = 0; c < cols; c++) cells.push(emptyCell(r === 0, null)); // row 0 = header (spec D2)
    rowNodes.push(tableRow.create(null, cells));
  }
  return table.create(undefined, rowNodes); // default attrs → blockId '' → blockIdentityPlugin assigns new-N
}

/** Insert a new empty table as a new top-level block after the current block. */
export function insertTable(rows: number, cols: number): Command {
  return (state, dispatch) => {
    if (findTable(state.selection.$from)) return false; // no nested tables
    const index = state.selection.$to.index(0);
    let end = 0;
    for (let i = 0; i <= index; i++) end += state.doc.child(i).nodeSize;
    if (dispatch) {
      const built = buildEmptyTable(rows, cols);
      const tr = state.tr.insert(end, built);
      tr.setSelection(TextSelection.near(tr.doc.resolve(cellContentPos(built, end, 0, 0))));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}
export function canInsertTable(state: EditorState): boolean {
  return !findTable(state.selection.$from);
}
