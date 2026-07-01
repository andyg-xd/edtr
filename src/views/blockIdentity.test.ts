import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { liveSchema } from './liveSchema';
import { blockIdentityPlugin } from './blockIdentity';

function stateWith(...blocks: import('prosemirror-model').Node[]) {
  const doc = liveSchema.node('doc', null, blocks);
  return EditorState.create({ doc, schema: liveSchema, plugins: [blockIdentityPlugin()] });
}
const para = (id: string, text = 'x') =>
  liveSchema.node('paragraph', { blockId: id, srcFrom: 1, srcTo: 2 }, [liveSchema.text(text)]);

describe('blockIdentityPlugin', () => {
  it('reassigns a DUPLICATE id: first block keeps id/range, second becomes new-N with cleared range', () => {
    // Simulates PM splitBlock copying attrs: two top-level blocks share id "b1".
    let state = stateWith(para('b1', 'one'), para('b1', 'two'));
    // appendTransaction runs on creation? It runs on applied transactions — force one no-op tx:
    state = state.apply(state.tr.insertText('!', 1));
    expect(state.doc.child(0).attrs.blockId).toBe('b1');
    expect(state.doc.child(0).attrs.srcFrom).toBe(1);
    const secondId = state.doc.child(1).attrs.blockId as string;
    expect(secondId.startsWith('new-')).toBe(true);
    expect(state.doc.child(1).attrs.srcFrom).toBe(0);
    expect(state.doc.child(1).attrs.srcTo).toBe(0);
  });

  it('assigns a fresh id to an EMPTY-id block', () => {
    let state = stateWith(para('b0', 'a'), para('', 'b'));
    state = state.apply(state.tr.insertText('!', 1));
    const id = state.doc.child(1).attrs.blockId as string;
    expect(id.startsWith('new-')).toBe(true);
  });

  it('emits NO transaction when all ids are already unique and non-empty', () => {
    let state = stateWith(para('b0', 'a'), para('b1', 'b'));
    const before = state.doc;
    state = state.apply(state.tr.setMeta('noop', true)); // a tx that does not change the doc
    // ids unchanged, no reassignment
    expect(state.doc.child(0).attrs.blockId).toBe('b0');
    expect(state.doc.child(1).attrs.blockId).toBe('b1');
    expect(state.doc.eq(before)).toBe(true);
  });
});
