import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { liveSchema } from './liveSchema';
import { buildLiveDoc } from './liveModel';
import { dirtyTrackingPlugin, getDirtyBlockIds } from './dirtyTracking';

function stateFor(src: string): EditorState {
  const r = buildLiveDoc(src);
  if (!r.ok) throw new Error('degraded');
  return EditorState.create({ doc: r.doc, schema: liveSchema, plugins: [dirtyTrackingPlugin()] });
}

describe('dirtyTrackingPlugin', () => {
  it('starts with no dirty blocks', () => {
    expect(getDirtyBlockIds(stateFor('alpha\n\nbeta\n')).size).toBe(0);
  });

  it('marks exactly the edited top-level block', () => {
    const s0 = stateFor('alpha\n\nbeta\n');
    // insert 'X' inside the SECOND block (paragraph 'beta')
    const secondStart = 1 + s0.doc.child(0).nodeSize + 1; // inside second paragraph
    const tr = s0.tr.insertText('X', secondStart);
    const s1 = s0.apply(tr);
    const dirty = getDirtyBlockIds(s1);
    expect(dirty.size).toBe(1);
    expect(dirty.has(s1.doc.child(1).attrs.blockId)).toBe(true);
    expect(dirty.has(s1.doc.child(0).attrs.blockId)).toBe(false);
  });

  it('un-marks a block when it is edited back to its baseline content', () => {
    const s0 = stateFor('alpha\n\nbeta\n');
    const pos = 1 + s0.doc.child(0).nodeSize + 1;
    const s1 = s0.apply(s0.tr.insertText('X', pos));
    expect(getDirtyBlockIds(s1).size).toBe(1);
    // delete the inserted 'X' → back to baseline
    const s2 = s1.apply(s1.tr.delete(pos, pos + 1));
    expect(getDirtyBlockIds(s2).size).toBe(0);
  });
});
