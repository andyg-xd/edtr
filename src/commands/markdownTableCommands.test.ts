import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { liveSchema } from '../views/liveSchema';
import { buildLiveDoc } from '../views/liveModel';
import { goToNextCell, arrowVertical, addRow, canAddRowAbove, deleteRow, canDeleteRow, addColumn, deleteColumn, canDeleteColumn, setColumnAlign, getColumnAlign } from './markdownTableCommands';

function setup(src: string) {
  const r = buildLiveDoc(src);
  if (!r.ok) throw new Error('degraded');
  return EditorState.create({ doc: r.doc, schema: liveSchema });
}
function cursorAtText(s: EditorState, needle: string): EditorState {
  let pos = -1;
  s.doc.descendants((node, p) => {
    if (pos === -1 && node.isText && node.text === needle) pos = p + 1;
  });
  if (pos === -1) throw new Error(`text not found: ${needle}`);
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos)));
}
function run(s: EditorState, cmd: Command): { ok: boolean; state: EditorState } {
  let next = s; const ok = cmd(s, (tr) => { next = s.apply(tr); }); return { ok, state: next };
}

// 2x2 table: header a,b ; body c,d
const SRC = '| a | b |\n| --- | --- |\n| c | d |\n';

describe('goToNextCell', () => {
  it('Tab moves forward through cells in row-major order', () => {
    let s = cursorAtText(setup(SRC), 'a');
    s = run(s, goToNextCell(1)).state; expect(s.selection.$from.parent.textContent).toBe('b');
    s = run(s, goToNextCell(1)).state; expect(s.selection.$from.parent.textContent).toBe('c');
    s = run(s, goToNextCell(1)).state; expect(s.selection.$from.parent.textContent).toBe('d');
  });

  it('Shift-Tab moves backward through cells', () => {
    let s = cursorAtText(setup(SRC), 'd');
    s = run(s, goToNextCell(-1)).state; expect(s.selection.$from.parent.textContent).toBe('c');
    s = run(s, goToNextCell(-1)).state; expect(s.selection.$from.parent.textContent).toBe('b');
  });

  it('is a no-op at the last cell (forward) and first cell (backward), consuming the key', () => {
    const last = run(cursorAtText(setup(SRC), 'd'), goToNextCell(1));
    expect(last.ok).toBe(true);
    expect(last.state.selection.$from.parent.textContent).toBe('d'); // stayed
    const first = run(cursorAtText(setup(SRC), 'a'), goToNextCell(-1));
    expect(first.ok).toBe(true);
    expect(first.state.selection.$from.parent.textContent).toBe('a'); // stayed
  });

  it('returns false when the cursor is not in a table', () => {
    const s = cursorAtText(setup('hello\n'), 'hello');
    expect(goToNextCell(1)(s)).toBe(false);
  });
});

describe('arrowVertical', () => {
  // 2x2 table: header row (a, b) + body row (c, d)
  // view is omitted in all tests so the intra-cell endOfTextblock gate is skipped

  it('ArrowDown from a → c (same column, next row)', () => {
    const s = cursorAtText(setup(SRC), 'a');
    const { state } = run(s, arrowVertical('down'));
    expect(state.selection.$from.parent.textContent).toBe('c');
  });

  it('ArrowDown from b → d (same column, next row)', () => {
    const s = cursorAtText(setup(SRC), 'b');
    const { state } = run(s, arrowVertical('down'));
    expect(state.selection.$from.parent.textContent).toBe('d');
  });

  it('ArrowUp from c → a (same column, previous row)', () => {
    const s = cursorAtText(setup(SRC), 'c');
    const { state } = run(s, arrowVertical('up'));
    expect(state.selection.$from.parent.textContent).toBe('a');
  });

  it('ArrowUp from a (top edge) → returns false, cursor unchanged', () => {
    const s = cursorAtText(setup(SRC), 'a');
    const { ok, state } = run(s, arrowVertical('up'));
    expect(ok).toBe(false);
    expect(state.selection.$from.parent.textContent).toBe('a');
  });

  it('ArrowDown from d (bottom edge) → returns false, cursor unchanged', () => {
    const s = cursorAtText(setup(SRC), 'd');
    const { ok, state } = run(s, arrowVertical('down'));
    expect(ok).toBe(false);
    expect(state.selection.$from.parent.textContent).toBe('d');
  });

  it('returns false when the cursor is not in a table', () => {
    const s = cursorAtText(setup('hello\n'), 'hello');
    expect(arrowVertical('down')(s)).toBe(false);
  });

  it('grid-navigates even when endOfTextblock reports false (no flaky gate)', () => {
    const s = cursorAtText(setup(SRC), 'a');
    const fakeView = { endOfTextblock: () => false } as any;
    let next = s;
    arrowVertical('down')(s, (tr) => { next = s.apply(tr); }, fakeView);
    expect(next.selection.$from.parent.textContent).toBe('c');
  });
});

// 3x3 table preceded by a heading — locks findTable's offset math on a non-square,
// non-first-block table (the foundation only covered a bare 2x2).
const SRC3 = '# H\n\n| a | b | c |\n| --- | --- | --- |\n| d | e | f |\n| g | h | i |\n';

describe('findTable / nav on a 3x3 table after a heading', () => {
  it('Tab walks row-major across all 9 cells', () => {
    let s = cursorAtText(setup(SRC3), 'a');
    for (const t of ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) {
      s = run(s, goToNextCell(1)).state;
      expect(s.selection.$from.parent.textContent).toBe(t);
    }
  });
  it('ArrowDown from b → e → h (middle column)', () => {
    let s = cursorAtText(setup(SRC3), 'b');
    s = run(s, arrowVertical('down')).state; expect(s.selection.$from.parent.textContent).toBe('e');
    s = run(s, arrowVertical('down')).state; expect(s.selection.$from.parent.textContent).toBe('h');
  });
  it('ArrowUp from f → c (same column, previous row)', () => {
    const s = cursorAtText(setup(SRC3), 'f');
    expect(run(s, arrowVertical('up')).state.selection.$from.parent.textContent).toBe('c');
  });
  it('ArrowUp from a top edge → false; ArrowDown from i bottom edge → false', () => {
    expect(arrowVertical('up')(cursorAtText(setup(SRC3), 'a'))).toBe(false);
    expect(arrowVertical('down')(cursorAtText(setup(SRC3), 'i'))).toBe(false);
  });
});

function tableOf(s: EditorState) { return s.doc.child(s.doc.childCount - 1); } // last block is the table in these fixtures

describe('addRow', () => {
  it('addRow("below") inserts an empty body row after the current row, cursor in its first cell', () => {
    const s = cursorAtText(setup(SRC), 'a');      // header row
    const { ok, state } = run(s, addRow('below'));
    expect(ok).toBe(true);
    expect(tableOf(state).childCount).toBe(3);     // header + new + old body
    expect(state.selection.$from.parent.textContent).toBe(''); // in the new empty cell
    const newRow = tableOf(state).child(1);
    expect(newRow.childCount).toBe(2);
    expect(newRow.child(0).attrs.header).toBe(false);
  });
  it('addRow("above") is disabled on the header row', () => {
    const s = cursorAtText(setup(SRC), 'a');
    expect(addRow('above')(s)).toBe(false);
    expect(canAddRowAbove(s)).toBe(false);
  });
  it('addRow("above") inserts before a body row', () => {
    const s = cursorAtText(setup(SRC), 'c');       // body row
    expect(canAddRowAbove(s)).toBe(true);
    const { state } = run(s, addRow('above'));
    expect(tableOf(state).childCount).toBe(3);
    // new row sits between header and old body: index 1 is the new empty row
    expect(tableOf(state).child(1).child(0).textContent).toBe('');
    expect(tableOf(state).child(2).child(0).textContent).toBe('c');
  });
});

describe('addColumn', () => {
  it('addColumn("right") inserts an empty cell into every row after the current column', () => {
    const s = cursorAtText(setup(SRC), 'a');   // col 0
    const { ok, state } = run(s, addColumn('right'));
    expect(ok).toBe(true);
    const t = tableOf(state);
    expect(t.child(0).childCount).toBe(3);     // header now 3 cells
    expect(t.child(1).childCount).toBe(3);     // body too
    expect(t.child(0).child(1).textContent).toBe(''); // new empty cell between a and b
    expect(t.child(0).child(1).attrs.header).toBe(true);
    expect(t.child(1).child(1).attrs.header).toBe(false);
    expect(state.selection.$from.parent.textContent).toBe(''); // cursor in the new cell
  });
  it('addColumn("left") inserts before the current column', () => {
    const s = cursorAtText(setup(SRC), 'b');   // col 1
    const t = tableOf(run(s, addColumn('left')).state);
    expect(t.child(0).child(1).textContent).toBe(''); // new empty cell before b
    expect(t.child(0).child(2).textContent).toBe('b');
  });
});

describe('deleteColumn', () => {
  it('removes the current column from every row', () => {
    const s = cursorAtText(setup(SRC), 'b');   // col 1
    const { ok, state } = run(s, deleteColumn);
    expect(ok).toBe(true);
    const t = tableOf(state);
    expect(t.child(0).childCount).toBe(1);
    expect(t.child(0).child(0).textContent).toBe('a');
    expect(t.child(1).child(0).textContent).toBe('c');
  });
  it('is disabled when only one column remains', () => {
    const oneCol = '| a |\n| --- |\n| c |\n';
    const s = cursorAtText(setup(oneCol), 'a');
    expect(canDeleteColumn(s)).toBe(false);
    expect(deleteColumn(s)).toBe(false);
  });
});

describe('column alignment', () => {
  it('setColumnAlign sets align on EVERY cell in the current column', () => {
    const s = cursorAtText(setup(SRC), 'a'); // col 0
    const { ok, state } = run(s, setColumnAlign('center'));
    expect(ok).toBe(true);
    const t = tableOf(state);
    expect(t.child(0).child(0).attrs.align).toBe('center'); // header cell
    expect(t.child(1).child(0).attrs.align).toBe('center'); // body cell
    expect(t.child(0).child(1).attrs.align).toBe(null);     // other column untouched
  });
  it('getColumnAlign reads the current column header cell align', () => {
    let s = cursorAtText(setup(SRC), 'a');
    expect(getColumnAlign(s)).toBe(null);
    s = run(s, setColumnAlign('right')).state;
    // cursor is still in column 0 after the op
    expect(getColumnAlign(s)).toBe('right');
  });
  it('setColumnAlign(null) clears alignment', () => {
    let s = cursorAtText(setup(SRC), 'a');
    s = run(s, setColumnAlign('left')).state;
    s = run(s, setColumnAlign(null)).state;
    expect(tableOf(s).child(0).child(0).attrs.align).toBe(null);
  });
});

describe('deleteRow', () => {
  it('deletes a body row', () => {
    const s = cursorAtText(setup(SRC), 'c');
    const { ok, state } = run(s, deleteRow);
    expect(ok).toBe(true);
    expect(tableOf(state).childCount).toBe(1);     // header only
  });
  it('on the header row, promotes the next row to header then removes row 0', () => {
    const s = cursorAtText(setup(SRC), 'a');        // header
    const { state } = run(s, deleteRow);
    expect(tableOf(state).childCount).toBe(1);
    const hdr = tableOf(state).child(0);
    expect(hdr.child(0).textContent).toBe('c');     // old body row promoted
    expect(hdr.child(0).attrs.header).toBe(true);
  });
  it('is disabled when only the header row remains', () => {
    const oneRow = '| a | b |\n| --- | --- |\n';
    const s = cursorAtText(setup(oneRow), 'a');
    expect(canDeleteRow(s)).toBe(false);
    expect(deleteRow(s)).toBe(false);
  });
});
