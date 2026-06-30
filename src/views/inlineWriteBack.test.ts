import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { liveSchema } from './liveSchema';
import { buildLiveDoc } from './liveModel';
import { dirtyTrackingPlugin, getDirtyBlockIds } from './dirtyTracking';
import { writeBack } from './ViewSync';
import { detectFlavor } from '../doc/flavor';
import { toggleStrong } from '../commands/markdownInlineCommands';

function selectBlock(state: EditorState, index: number): EditorState {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize;
  const block = state.doc.child(index);
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, pos + 1, pos + 1 + block.content.size)),
  );
}

describe('inline formatting write-back (no-beautify)', () => {
  it('bolding one block changes only that block; all others byte-identical', () => {
    const source = '# Title\n\nfirst para\n\n- a\n- b\n';
    const r = buildLiveDoc(source);
    if (!r.ok) throw new Error('degraded');
    let state = EditorState.create({ doc: r.doc, schema: liveSchema, plugins: [dirtyTrackingPlugin()] });
    state = selectBlock(state, 1); // the "first para" paragraph

    const ok = toggleStrong(state, (tr) => { state = state.apply(tr); });
    expect(ok).toBe(true);

    const dirty = getDirtyBlockIds(state);
    expect(dirty.size).toBe(1); // only the paragraph is dirty

    const flavor = detectFlavor(source, 'markdown');
    const out = writeBack(state.doc, source, dirty, flavor);

    expect(out).toBe('# Title\n\n**first para**\n\n- a\n- b\n');
    // The untouched heading + list bytes survive verbatim:
    expect(out.startsWith('# Title\n\n')).toBe(true);
    expect(out.endsWith('\n\n- a\n- b\n')).toBe(true);
  });

  it('a no-op edit (no dirty blocks) returns the source byte-for-byte', () => {
    const source = '# Title\n\nfirst para\n';
    const r = buildLiveDoc(source);
    if (!r.ok) throw new Error('degraded');
    const state = EditorState.create({ doc: r.doc, schema: liveSchema, plugins: [dirtyTrackingPlugin()] });
    const flavor = detectFlavor(source, 'markdown');
    expect(writeBack(state.doc, source, getDirtyBlockIds(state), flavor)).toBe(source);
  });
});
