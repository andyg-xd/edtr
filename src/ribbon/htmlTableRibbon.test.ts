// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { toLiveHtml } from '../views/htmlModel';
import { htmlSchema } from '../views/htmlSchema';
import { htmlTableRibbon } from './htmlTableRibbon';
import { htmlRibbon } from './htmlRibbon';

function cursorInCell() {
  const r = toLiveHtml('<html><body><table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table></body></html>');
  if (!r.ok) throw new Error('degraded');
  let state = EditorState.create({ doc: r.doc, schema: htmlSchema });
  let at = -1;
  state.doc.descendants((n: any, pos: number) => { if (at < 0 && n.isText && n.text === 'a') at = pos; });
  return state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(at))));
}

describe('htmlTableRibbon', () => {
  it('exposes the row/col/align/header controls, enabled inside a table', () => {
    const state = cursorInCell();
    const ids = htmlTableRibbon.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['rowAbove', 'rowBelow', 'colLeft', 'colRight', 'delRow', 'delCol', 'columnAlign', 'headerRow', 'headerCol']));
    for (const c of htmlTableRibbon) expect(c.isEnabled(state)).toBe(true);
  });

  it('the align dropdown reflects the current column alignment', () => {
    const state = cursorInCell();
    const align = htmlTableRibbon.find((c) => c.id === 'columnAlign')!;
    expect(align.action.kind).toBe('dropdown');
    if (align.action.kind === 'dropdown') expect(align.action.getValue(state)).toBe(''); // default
  });

  it('exposes a header-column toggle enabled in a table, inactive when column 0 is not a header', () => {
    const state = cursorInCell(); // <td> table → column 0 is not a header
    const ctrl = htmlTableRibbon.find((c) => c.id === 'headerCol')!;
    expect(ctrl).toBeTruthy();
    expect(ctrl.isEnabled(state)).toBe(true);
    expect(ctrl.isActive(state)).toBe(false);
  });
});

describe('htmlRibbon — insert table', () => {
  it('has an insert-table sizePicker control', () => {
    const ctrl = htmlRibbon.find((c) => c.id === 'insertTable');
    expect(ctrl).toBeTruthy();
    expect(ctrl!.action.kind).toBe('sizePicker');
  });
});
