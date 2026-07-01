import { TextSelection, type Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { liveSchema } from '../views/liveSchema';

/**
 * Move the cursor to the next (dir=1) or previous (dir=-1) table cell, row-major.
 * Returns false when not inside a table cell (so Tab behaves normally elsewhere);
 * a no-op that consumes the key at the table's last/first cell.
 */
export function goToNextCell(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    let depth = $from.depth;
    while (depth > 0 && $from.node(depth).type !== liveSchema.nodes.tableCell) depth--;
    if (depth === 0) return false; // not in a table cell
    const tableDepth = depth - 2;  // doc > … > table > tableRow > tableCell
    if (tableDepth < 0 || $from.node(tableDepth).type !== liveSchema.nodes.table) return false;

    // Collect the content-start position of every cell, row-major.
    const table = $from.node(tableDepth);
    const tableStart = $from.start(tableDepth); // position of the first row's open token
    const cellStarts: number[] = [];
    let pos = tableStart;
    table.forEach((row) => {
      let rpos = pos + 1; // inside the row (first cell's open token)
      row.forEach((cell) => {
        cellStarts.push(rpos + 1); // inside the cell (content start)
        rpos += cell.nodeSize;
      });
      pos += row.nodeSize;
    });

    const curStart = $from.before(depth) + 1; // this cell's content start
    const idx = cellStarts.indexOf(curStart);
    if (idx === -1) return false;
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= cellStarts.length) return true; // no-op at ends, consume key
    if (dispatch) {
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, cellStarts[targetIdx])).scrollIntoView());
    }
    return true;
  };
}

/**
 * Move the cursor to the cell directly above or below in the SAME COLUMN.
 * Up/Down ALWAYS move to the adjacent row's same-column cell (deterministic grid nav).
 * Returns false only when not in a table, or at the table's top/bottom edge
 * (so Up/Down can exit the table via default motion).
 * Tradeoff (acceptable for GFM): arrows do not move within a multi-line cell before
 * crossing rows — Up/Down always cross to the adjacent row. Click still places
 * the cursor anywhere within a cell.
 */
export function arrowVertical(dir: 'up' | 'down'): Command {
  return (state, dispatch, _view?: EditorView) => {
    const sel = state.selection;
    if (!sel.empty) return false;
    const $from = sel.$from;
    let depth = $from.depth;
    while (depth > 0 && $from.node(depth).type !== liveSchema.nodes.tableCell) depth--;
    if (depth === 0) return false;
    const tableDepth = depth - 2;
    if (tableDepth < 0 || $from.node(tableDepth).type !== liveSchema.nodes.table) return false;
    const rowIndex = $from.index(tableDepth);
    const colIndex = $from.index(tableDepth + 1);
    const table = $from.node(tableDepth);
    const targetRowIndex = rowIndex + (dir === 'down' ? 1 : -1);
    if (targetRowIndex < 0 || targetRowIndex >= table.childCount) return false; // exit table
    const targetRow = table.child(targetRowIndex);
    if (colIndex >= targetRow.childCount) return false; // ragged safety
    // Compute target cell content-start position
    let pos = $from.start(tableDepth); // position inside table's open token (first row's open token)
    for (let r = 0; r < targetRowIndex; r++) pos += table.child(r).nodeSize;
    pos += 1; // inside target row
    for (let c = 0; c < colIndex; c++) pos += targetRow.child(c).nodeSize;
    pos += 1; // inside target cell (content start)
    if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)).scrollIntoView());
    return true;
  };
}
