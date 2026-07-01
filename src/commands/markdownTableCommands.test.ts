import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { liveSchema } from '../views/liveSchema';
import { buildLiveDoc } from '../views/liveModel';
import { goToNextCell, arrowVertical } from './markdownTableCommands';

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
