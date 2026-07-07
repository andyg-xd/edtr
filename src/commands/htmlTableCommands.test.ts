// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { toLiveHtml } from '../views/htmlModel';
import { htmlSchema } from '../views/htmlSchema';
import {
  findTable, isInTable, goToNextCell, arrowVertical,
  addRow, deleteRow, canDeleteRow,
  addColumn, deleteColumn, canDeleteColumn,
  setColumnAlign, getColumnAlign, toggleHeaderRow, headerRowActive,
  buildEmptyTable, insertTable, canInsertTable,
} from './htmlTableCommands';
import type { Command } from 'prosemirror-state';

function run(state: EditorState, cmd: Command): EditorState {
  let out = state;
  cmd(state, (tr) => { out = state.apply(tr); });
  return out;
}

function stateFor(bodyHtml: string) {
  const r = toLiveHtml(`<html><body>${bodyHtml}</body></html>`);
  if (!r.ok) throw new Error(`degraded: ${r.reason}`);
  return EditorState.create({ doc: r.doc, schema: htmlSchema });
}
function posOfText(doc: any, needle: string): number {
  let at = -1;
  doc.descendants((n: any, pos: number) => {
    if (at < 0 && n.isText && typeof n.text === 'string' && n.text.includes(needle)) at = pos + n.text.indexOf(needle);
  });
  if (at < 0) throw new Error(`text not found: ${needle}`);
  return at;
}
function cursorAt(state: EditorState, needle: string): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(posOfText(state.doc, needle)))));
}

describe('htmlTableCommands — findTable / isInTable', () => {
  it('locates the enclosing table and cell indices from a cursor in a cell', () => {
    const state = cursorAt(stateFor('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>'), 'd');
    const ctx = findTable(state.selection.$from);
    expect(ctx).not.toBeNull();
    expect(ctx!.rowIndex).toBe(1);
    expect(ctx!.colIndex).toBe(1);
    expect(ctx!.colCount).toBe(2);
    expect(isInTable(state)).toBe(true);
  });
  it('returns null outside a table', () => {
    const state = cursorAt(stateFor('<p>x</p>'), 'x');
    expect(findTable(state.selection.$from)).toBeNull();
    expect(isInTable(state)).toBe(false);
  });
});

describe('htmlTableCommands — goToNextCell', () => {
  it('Tab moves to the next cell (row-major)', () => {
    const state = cursorAt(stateFor('<table><tr><td>a</td><td>b</td></tr></table>'), 'a');
    let next: EditorState | null = null;
    const handled = goToNextCell(1)(state, (tr) => { next = state.apply(tr); });
    expect(handled).toBe(true);
    expect(findTable(next!.selection.$from)!.colIndex).toBe(1);
  });
  it('Shift-Tab moves to the previous cell', () => {
    const state = cursorAt(stateFor('<table><tr><td>a</td><td>b</td></tr></table>'), 'b');
    let next: EditorState | null = null;
    goToNextCell(-1)(state, (tr) => { next = state.apply(tr); });
    expect(findTable(next!.selection.$from)!.colIndex).toBe(0);
  });
  it('Tab at the last cell appends a body row and lands in its first cell', () => {
    const state = cursorAt(stateFor('<table><tr><td>a</td><td>b</td></tr></table>'), 'b');
    const next = run(state, goToNextCell(1));
    const ctx = findTable(next.selection.$from)!;
    expect(ctx.table.childCount).toBe(2);           // row appended
    expect(ctx.rowIndex).toBe(1);                   // cursor in the new row
    expect(ctx.colIndex).toBe(0);
    expect(ctx.table.child(1).child(0).attrs.header).toBe(false);
  });
  it('returns false outside a table so Tab falls through', () => {
    const state = cursorAt(stateFor('<p>x</p>'), 'x');
    expect(goToNextCell(1)(state, () => {})).toBe(false);
  });
});

describe('htmlTableCommands — arrowVertical', () => {
  it('ArrowDown moves to the same column in the next row', () => {
    const state = cursorAt(stateFor('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>'), 'b');
    let next: EditorState | null = null;
    const handled = arrowVertical('down')(state, (tr) => { next = state.apply(tr); });
    expect(handled).toBe(true);
    const ctx = findTable(next!.selection.$from)!;
    expect(ctx.rowIndex).toBe(1);
    expect(ctx.colIndex).toBe(1);
  });
  it('ArrowUp at the top row returns false (lets the cursor exit the table)', () => {
    const state = cursorAt(stateFor('<table><tr><td>a</td></tr></table>'), 'a');
    expect(arrowVertical('up')(state, () => {})).toBe(false);
  });
});

describe('htmlTableCommands — row ops', () => {
  it('addRow("below") inserts a body row of empty cells and preserves blockId', () => {
    const state = cursorAt(stateFor('<table><tr><td>a</td><td>b</td></tr></table>'), 'a');
    const before = findTable(state.selection.$from)!.table.attrs.blockId;
    const next = run(state, addRow('below'));
    const ctx = findTable(next.selection.$from)!;
    expect(ctx.table.childCount).toBe(2);
    expect(ctx.table.child(1).childCount).toBe(2);       // 2 columns
    expect(ctx.table.child(1).child(0).attrs.header).toBe(false);
    expect(ctx.table.child(1).child(0).type.name).toBe('tableCell');
    expect(ctx.table.child(1).child(0).firstChild!.type.name).toBe('paragraph'); // block+ satisfied
    expect(ctx.table.attrs.blockId).toBe(before);        // same block → reconciler re-serializes in place
  });

  it('addRow("above") inserts above the current row (allowed at row 0 in HTML)', () => {
    const state = cursorAt(stateFor('<table><tr><td>a</td></tr></table>'), 'a');
    const next = run(state, addRow('above'));
    expect(findTable(next.selection.$from)!.table.childCount).toBe(2);
  });

  it('deleteRow removes the current row without promoting (min 1 row)', () => {
    const state = cursorAt(stateFor('<table><tr><th>h</th></tr><tr><td>a</td></tr></table>'), 'a');
    const next = run(state, deleteRow);
    const ctx = findTable(next.selection.$from)!;
    expect(ctx.table.childCount).toBe(1);
    expect(ctx.table.child(0).child(0).attrs.header).toBe(true); // surviving header stays a header
  });

  it('canDeleteRow is false at a single-row table', () => {
    const state = cursorAt(stateFor('<table><tr><td>a</td></tr></table>'), 'a');
    expect(canDeleteRow(state)).toBe(false);
    expect(deleteRow(state, () => {})).toBe(false);
  });
});

describe('htmlTableCommands — column ops', () => {
  it('addColumn("right") adds a column; the new cell in a header row is a header', () => {
    const state = cursorAt(stateFor('<table><tr><th>h1</th></tr><tr><td>a</td></tr></table>'), 'h1');
    const next = run(state, addColumn('right'));
    const ctx = findTable(next.selection.$from)!;
    expect(ctx.colCount).toBe(2);
    expect(ctx.table.child(0).child(1).attrs.header).toBe(true);  // header row → new <th>
    expect(ctx.table.child(1).child(1).attrs.header).toBe(false); // body row → new <td>
    expect(ctx.table.child(0).child(1).firstChild!.type.name).toBe('paragraph');
  });

  it('deleteColumn removes the current column (min 1 column)', () => {
    const state = cursorAt(stateFor('<table><tr><td>a</td><td>b</td></tr></table>'), 'b');
    const next = run(state, deleteColumn);
    expect(findTable(next.selection.$from)!.colCount).toBe(1);
  });

  it('canDeleteColumn is false at a single-column table', () => {
    const state = cursorAt(stateFor('<table><tr><td>a</td></tr></table>'), 'a');
    expect(canDeleteColumn(state)).toBe(false);
    expect(deleteColumn(state, () => {})).toBe(false);
  });
});

describe('htmlTableCommands — alignment + header toggle', () => {
  it('setColumnAlign sets the whole column and getColumnAlign reads it back', () => {
    const state = cursorAt(stateFor('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>'), 'c');
    const next = run(state, setColumnAlign('center'));
    const ctx = findTable(next.selection.$from)!;
    expect(ctx.table.child(0).child(0).attrs.align).toBe('center'); // whole column, both rows
    expect(ctx.table.child(1).child(0).attrs.align).toBe('center');
    expect(ctx.table.child(0).child(1).attrs.align).toBeNull();     // other column untouched
    expect(getColumnAlign(next)).toBe('center');
  });

  it('toggleHeaderRow flips row 0 between th and td', () => {
    const state = cursorAt(stateFor('<table><tr><td>a</td><td>b</td></tr></table>'), 'a');
    expect(headerRowActive(state)).toBe(false);
    const on = run(state, toggleHeaderRow);
    expect(findTable(on.selection.$from)!.table.child(0).child(0).attrs.header).toBe(true);
    expect(headerRowActive(on)).toBe(true);
    const off = run(on, toggleHeaderRow);
    expect(findTable(off.selection.$from)!.table.child(0).child(0).attrs.header).toBe(false);
  });
});

describe('htmlTableCommands — insert table', () => {
  it('buildEmptyTable makes an R×C table with a header row and empty <p> cells', () => {
    const t = buildEmptyTable(3, 2);
    expect(t.childCount).toBe(3);
    expect(t.child(0).childCount).toBe(2);
    expect(t.child(0).child(0).attrs.header).toBe(true);   // row 0 = header
    expect(t.child(1).child(0).attrs.header).toBe(false);  // body
    expect(t.child(0).child(0).firstChild!.type.name).toBe('paragraph');
    expect(t.attrs.blockId).toBe('');                      // default → blockIdentityPlugin assigns new-N
  });

  it('insertTable adds a new top-level table after the current block', () => {
    const state = cursorAt(stateFor('<p>x</p>'), 'x');
    const next = run(state, insertTable(2, 2));
    expect(isInTable(next)).toBe(true);
    expect(next.doc.childCount).toBe(2); // <p> + new table
  });

  it('canInsertTable is false when already inside a table', () => {
    const state = cursorAt(stateFor('<table><tr><td>a</td></tr></table>'), 'a');
    expect(canInsertTable(state)).toBe(false);
    expect(insertTable(2, 2)(state, () => {})).toBe(false);
  });
});
