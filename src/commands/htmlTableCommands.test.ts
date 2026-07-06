// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { toLiveHtml } from '../views/htmlModel';
import { htmlSchema } from '../views/htmlSchema';
import { findTable, isInTable, goToNextCell, arrowVertical } from './htmlTableCommands';

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
  it('Tab at the last cell consumes the key as a no-op (append is 4d-iv-b)', () => {
    const state = cursorAt(stateFor('<table><tr><td>a</td></tr></table>'), 'a');
    let dispatched: EditorState | null = null;
    const handled = goToNextCell(1)(state, (tr) => { dispatched = state.apply(tr); });
    expect(handled).toBe(true);       // consumed
    expect(dispatched).toBeNull();    // no transaction — row NOT appended
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
