import { TextSelection, type Command } from 'prosemirror-state';
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
