import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { liveSchema } from '../views/liveSchema';
import { buildLiveDoc } from '../views/liveModel';
import { markdownTableRibbon } from './markdownTableRibbon';

function stateAt(src: string, needle: string): EditorState {
  const r = buildLiveDoc(src);
  if (!r.ok) throw new Error('degraded');
  let s = EditorState.create({ doc: r.doc, schema: liveSchema });
  let pos = -1;
  s.doc.descendants((n, p) => { if (pos === -1 && n.isText && n.text === needle) pos = p + 1; });
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos)));
}
const byId = (id: string) => markdownTableRibbon.find((c) => c.id === id)!;
const SRC = '| a | b |\n| --- | --- |\n| c | d |\n';

describe('markdownTableRibbon', () => {
  it('exposes the row/col/align controls', () => {
    for (const id of ['rowAbove', 'rowBelow', 'colLeft', 'colRight', 'delRow', 'delCol', 'columnAlign']) {
      expect(byId(id)).toBeTruthy();
    }
  });
  it('delRow is disabled on a header-only table; rowAbove disabled on the header row', () => {
    const headerOnly = stateAt('| a | b |\n| --- | --- |\n', 'a');
    expect(byId('delRow').isEnabled(headerOnly)).toBe(false);
    expect(byId('rowAbove').isEnabled(headerOnly)).toBe(false);
  });
  it('delCol disabled at one column', () => {
    const oneCol = stateAt('| a |\n| --- |\n| c |\n', 'a');
    expect(byId('delCol').isEnabled(oneCol)).toBe(false);
  });
  it('the align dropdown reflects the current column and maps null↔""', () => {
    const s = stateAt(SRC, 'a');
    const ctrl = byId('columnAlign');
    if (ctrl.action.kind !== 'dropdown') throw new Error('expected dropdown');
    expect(ctrl.action.getValue(s)).toBe(''); // null → ''
  });
});
