import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { liveSchema } from './liveSchema';
import { buildLiveDoc } from './liveModel';
import { blockIdentityPlugin } from './blockIdentity';
import { dirtyTrackingPlugin, getDirtyBlockIds } from './dirtyTracking';
import { writeBack } from './ViewSync';
import { detectFlavor } from '../doc/flavor';
import { addColumn, deleteColumn, deleteRow, setColumnAlign, insertTable } from '../commands/markdownTableCommands';

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

// Build a plugged-in state, put the cursor at `needle`, run `cmd`, return the write-back output.
function afterCmd(src: string, needle: string, cmd: import('prosemirror-state').Command): string {
  const flavor = detectFlavor(src, 'markdown');
  const base = docFor(src);
  let state = EditorState.create({ doc: base, schema: liveSchema, plugins: [blockIdentityPlugin(), dirtyTrackingPlugin()] });
  const pos = posOfText(state.doc, needle) + 1; // inside the text node
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  let next = state;
  cmd(state, (tr) => { next = state.apply(tr); });
  return writeBack(next.doc, src, getDirtyBlockIds(next), flavor, base);
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

describe('structural table ops — no beautify', () => {
  const SRC = '# T\n\n| a | b |\n| --- | --- |\n| c | d |\n\nEnd.\n';

  it('addColumn re-serializes only the table; neighbors byte-identical', () => {
    const out = afterCmd(SRC, 'a', addColumn('right'));
    expect(out.startsWith('# T\n\n')).toBe(true);
    expect(out.endsWith('\n\nEnd.\n')).toBe(true);
    expect(out).toContain('| a |  | b |');
    expect(out).toContain('| --- | --- | --- |');
    expect(out).toContain('| c |  | d |');
  });

  it('deleteColumn drops a column; neighbors byte-identical', () => {
    const out = afterCmd(SRC, 'b', deleteColumn);
    expect(out.startsWith('# T\n\n')).toBe(true);
    expect(out.endsWith('\n\nEnd.\n')).toBe(true);
    expect(out).toContain('| a |\n| --- |\n| c |');
  });

  it('deleteRow on the header promotes the next row; neighbors byte-identical', () => {
    const out = afterCmd(SRC, 'a', deleteRow);
    expect(out.startsWith('# T\n\n')).toBe(true);
    expect(out.endsWith('\n\nEnd.\n')).toBe(true);
    expect(out).toContain('| c | d |\n| --- | --- |'); // old body row is now the header
  });

  it('setColumnAlign changes only the delimiter row; neighbors byte-identical', () => {
    const out = afterCmd(SRC, 'a', setColumnAlign('center'));
    expect(out.startsWith('# T\n\n')).toBe(true);
    expect(out.endsWith('\n\nEnd.\n')).toBe(true);
    expect(out).toContain('| :-: | --- |');
  });

  it('inserting a new table serializes to valid GFM; neighbors byte-identical', () => {
    const out = afterCmd('Hello.\n', 'Hello', insertTable(2, 2));
    expect(out.startsWith('Hello.\n')).toBe(true);
    expect(out).toContain('|  |  |\n| --- | --- |\n|  |  |');
  });
});
