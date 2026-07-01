import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { joinBackward } from 'prosemirror-commands';
import { liveSchema } from './liveSchema';
import { buildLiveDoc } from './liveModel';
import { blockIdentityPlugin } from './blockIdentity';
import { dirtyTrackingPlugin, getDirtyBlockIds } from './dirtyTracking';
import { writeBack } from './ViewSync';
import { detectFlavor } from '../doc/flavor';
import { splitCommand, insertHorizontalRule } from '../commands/markdownStructureCommands';
import { toggleBlockquote } from '../commands/markdownBlockCommands';

function setup(src: string) {
  const r = buildLiveDoc(src);
  if (!r.ok) throw new Error('degraded');
  const base = r.doc;
  return { base, flavor: detectFlavor(src, 'markdown') };
}
function cursor(s: EditorState, index: number, offset = 1) {
  let pos = 0; for (let i = 0; i < index; i++) pos += s.doc.child(i).nodeSize;
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos + offset)));
}
function run(s: EditorState, cmd: Command) { let n = s; cmd(s, (tr) => { n = s.apply(tr); }); return n; }

describe('structural write-back (no beautify, end-to-end)', () => {
  it('splitting a paragraph writes both halves; other blocks byte-identical', () => {
    const src = '# Title\n\nonetwo\n\nlast\n';
    const { base, flavor } = setup(src);
    let s = cursor(EditorState.create({ doc: base, schema: liveSchema, plugins: [blockIdentityPlugin(), dirtyTrackingPlugin()] }), 1, 4); // after "one"
    s = run(s, splitCommand);
    const out = writeBack(s.doc, src, getDirtyBlockIds(s), flavor, base);
    expect(out).toBe('# Title\n\none\n\ntwo\n\nlast\n');
    expect(out.startsWith('# Title\n\n')).toBe(true);
    expect(out.endsWith('\n\nlast\n')).toBe(true);
  });

  it('merging via Backspace collapses two blocks; neighbors byte-identical', () => {
    const src = '# Title\n\none\n\ntwo\n\nlast\n';
    const { base, flavor } = setup(src);
    let s = EditorState.create({ doc: base, schema: liveSchema, plugins: [blockIdentityPlugin(), dirtyTrackingPlugin()] });
    const start = base.child(0).nodeSize + base.child(1).nodeSize + 1; // start of block index 2 ("two")
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, start)));
    s = run(s, joinBackward);
    const out = writeBack(s.doc, src, getDirtyBlockIds(s), flavor, base);
    expect(out).toBe('# Title\n\nonetwo\n\nlast\n');
  });

  it('inserting an HR writes --- with synthesized separators; other blocks intact', () => {
    const src = '# Title\n\nbody\n';
    const { base, flavor } = setup(src);
    let s = cursor(EditorState.create({ doc: base, schema: liveSchema, plugins: [blockIdentityPlugin(), dirtyTrackingPlugin()] }), 1, 1);
    s = run(s, insertHorizontalRule);
    const out = writeBack(s.doc, src, getDirtyBlockIds(s), flavor, base);
    expect(out).toBe('# Title\n\nbody\n\n---\n\n\n');
  });

  it('wrap then unwrap returns to byte-identical source (carry-forward golden)', () => {
    const src = '# Title\n\nhello world\n\nlast\n';
    const { base, flavor } = setup(src);
    let s = cursor(EditorState.create({ doc: base, schema: liveSchema, plugins: [blockIdentityPlugin(), dirtyTrackingPlugin()] }), 1, 1);
    s = run(s, toggleBlockquote); // wrap
    s = cursor(s, 1, 2);          // re-enter the (now nested) paragraph
    s = run(s, toggleBlockquote); // unwrap
    const out = writeBack(s.doc, src, getDirtyBlockIds(s), flavor, base);
    expect(out).toBe(src);
  });
});
