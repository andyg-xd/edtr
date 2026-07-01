import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { liveSchema } from './liveSchema';
import { buildLiveDoc } from './liveModel';
import { blockIdentityPlugin } from './blockIdentity';
import { dirtyTrackingPlugin, getDirtyBlockIds } from './dirtyTracking';
import { writeBack } from './ViewSync';
import { detectFlavor } from '../doc/flavor';

function docFor(src: string) {
  const r = buildLiveDoc(src);
  if (!r.ok) throw new Error('degraded');
  return r.doc;
}
function posOfText(doc: import('prosemirror-model').Node, needle: string): number {
  let pos = -1;
  doc.descendants((node, p) => {
    if (pos === -1 && node.isText && node.text?.includes(needle)) pos = p + node.text.indexOf(needle);
  });
  if (pos === -1) throw new Error(`text not found: ${needle}`);
  return pos;
}

describe('table write-back (no beautify)', () => {
  it('an UNTOUCHED hand-padded table round-trips byte-for-byte', () => {
    const src = '# T\n\n| Name  | Age |\n| :---- | --: |\n| Bob   | 30  |\n\nEnd.\n';
    const flavor = detectFlavor(src, 'markdown');
    expect(writeBack(docFor(src), src, new Set(), flavor)).toBe(src);
  });

  it('editing a cell re-serializes only the table; neighbors byte-identical', () => {
    const src = '# T\n\n| Name  | Age |\n| :---- | --: |\n| Bob   | 30  |\n\nEnd.\n';
    const flavor = detectFlavor(src, 'markdown');
    const base = docFor(src);
    let state = EditorState.create({ doc: base, schema: liveSchema, plugins: [blockIdentityPlugin(), dirtyTrackingPlugin()] });
    const pos = posOfText(state.doc, 'Bob') + 'Bob'.length; // end of "Bob"
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)).insertText('by', pos)); // Bob -> Bobby
    const out = writeBack(state.doc, src, getDirtyBlockIds(state), flavor, base);
    expect(out.startsWith('# T\n\n')).toBe(true);   // heading byte-identical
    expect(out.endsWith('\n\nEnd.\n')).toBe(true);  // trailing block + newline byte-identical
    expect(out).toContain('Bobby');                 // the edit landed
    expect(out).toContain('| Name | Age |');        // table re-serialized canonically
  });
});
