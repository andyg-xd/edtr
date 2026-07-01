import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import { liveSchema } from '../views/liveSchema';

const { table, tableRow, tableCell } = liveSchema.nodes;

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

// ---------------------------------------------------------------------------
// Shared table-mutation helpers (module-private)
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
function headerAligns(t: PMNode): Align[] {
  return cellsOf(t.child(0)).map((c) => c.attrs.align as Align);
}
function withHeader(cell: PMNode, header: boolean): PMNode {
  return tableCell.create({ ...cell.attrs, header }, cell.content);
}
// exported so Tasks 3-6 can import it; used for column alignment ops
export function withAlign(cell: PMNode, align: Align): PMNode {
  return tableCell.create({ ...cell.attrs, align }, cell.content);
}

/** Content-start position of cell (rowIndex,colIndex) in `t`, whose OWN open token sits at `tableFrom`. */
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
 * attrs (blockId/range) so dirtyTracking marks the SAME block dirty and the
 * reconciler re-serializes it in place. Cursor → cell (row,col) of newTable.
 */
function replaceTableTr(state: EditorState, ctx: TableContext, newTable: PMNode, row: number, col: number) {
  const from = ctx.tableStart - 1; // the table node's own open token
  const to = from + ctx.table.nodeSize;
  const tr = state.tr.replaceWith(from, to, newTable);
  tr.setSelection(TextSelection.create(tr.doc, cellContentPos(newTable, from, row, col)));
  return tr.scrollIntoView();
}

// ---------------------------------------------------------------------------
// Row commands
// ---------------------------------------------------------------------------

export function addRow(dir: 'above' | 'below'): Command {
  return (state, dispatch) => {
    const ctx = findTable(state.selection.$from);
    if (!ctx) return false;
    if (dir === 'above' && ctx.rowIndex === 0) return false; // nothing above the header
    const at = dir === 'above' ? ctx.rowIndex : ctx.rowIndex + 1;
    const newRow = tableRow.create(null, headerAligns(ctx.table).map((a) => tableCell.create({ header: false, align: a })));
    const rows = rowsOf(ctx.table);
    rows.splice(at, 0, newRow);
    if (dispatch) dispatch(replaceTableTr(state, ctx, table.create(ctx.table.attrs, rows), at, 0));
    return true;
  };
}
export function canAddRowAbove(state: EditorState): boolean {
  const ctx = findTable(state.selection.$from);
  return !!ctx && ctx.rowIndex > 0;
}

export const deleteRow: Command = (state, dispatch) => {
  const ctx = findTable(state.selection.$from);
  if (!ctx || ctx.table.childCount <= 1) return false;
  const rows = rowsOf(ctx.table);
  if (ctx.rowIndex === 0) {
    rows[1] = tableRow.create(rows[1].attrs, cellsOf(rows[1]).map((c) => withHeader(c, true)));
    rows.splice(0, 1);
  } else {
    rows.splice(ctx.rowIndex, 1);
  }
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

export function addColumn(dir: 'left' | 'right'): Command {
  return (state, dispatch) => {
    const ctx = findTable(state.selection.$from);
    if (!ctx) return false;
    const at = dir === 'left' ? ctx.colIndex : ctx.colIndex + 1;
    const rows = rowsOf(ctx.table).map((row, r) => {
      const cells = cellsOf(row);
      cells.splice(at, 0, tableCell.create({ header: r === 0, align: null }));
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
// Column alignment commands
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
