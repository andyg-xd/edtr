import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { htmlSchema } from './htmlSchema';
import { toLiveHtml } from './htmlModel';
import { htmlStructureLockPlugin } from './htmlStructureLock';
import { setHeading } from '../commands/htmlBlockCommands';

function state(src: string) {
  const r = toLiveHtml(src);
  if (!r.ok) throw new Error(r.reason);
  return EditorState.create({ doc: r.doc, schema: htmlSchema, plugins: [htmlStructureLockPlugin()] });
}

describe('htmlStructureLockPlugin', () => {
  it('allows a within-block text insertion', () => {
    const s = state('<html><body><p>hi</p></body></html>');
    const tr = s.tr.insertText('!', 2); // inside the paragraph
    const next = s.apply(tr);
    expect(next.doc.child(0).textContent).toBe('h!i');
    expect(next.doc.childCount).toBe(1);
  });

  it('rejects deleting a whole top-level block', () => {
    const s = state('<html><body><p>a</p><p>b</p></body></html>');
    expect(s.doc.childCount).toBe(2);
    const first = s.doc.child(0);
    const tr = s.tr.delete(0, first.nodeSize); // remove the first block
    const next = s.apply(tr);
    expect(next.doc.childCount).toBe(2); // rejected → unchanged
  });

  it('allows a selection-only transaction', () => {
    const s = state('<html><body><p>hi</p></body></html>');
    const tr = s.tr.setSelection(TextSelection.create(s.doc, 1));
    const next = s.apply(tr);
    expect(next.selection.from).toBe(1);
  });
});

describe('htmlStructureLockPlugin — 4c type-transform relaxation', () => {
  it('permits a BLOCK_TRANSFORM-tagged type change', () => {
    const res = toLiveHtml('<html><body><p>a</p><p>b</p></body></html>');
    if (!res.ok) throw new Error('degraded');
    let state = EditorState.create({
      doc: res.doc, schema: htmlSchema, plugins: [htmlStructureLockPlugin()],
    });
    state = state.apply(state.tr.setSelection(TextSelection.near(res.doc.resolve(1))));
    let after = state;
    setHeading(2)(state, (tr) => { after = state.apply(tr); });
    expect(after.doc.child(0).type.name).toBe('heading'); // not rejected
  });

  it('still rejects an untagged top-level delete', () => {
    const res = toLiveHtml('<html><body><p>a</p><p>b</p></body></html>');
    if (!res.ok) throw new Error('degraded');
    const state = EditorState.create({
      doc: res.doc, schema: htmlSchema, plugins: [htmlStructureLockPlugin()],
    });
    const after = state.apply(state.tr.delete(0, res.doc.child(0).nodeSize));
    expect(after.doc.childCount).toBe(2); // filtered out → unchanged
  });
});
