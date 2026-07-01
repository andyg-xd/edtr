import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { liveSchema } from './liveSchema';
import { buildLiveDoc } from './liveModel';
import { dirtyTrackingPlugin, getDirtyBlockIds } from './dirtyTracking';
import { writeBack } from './ViewSync';
import { detectFlavor } from '../doc/flavor';
import { setHeading, toggleBlockquote, toggleCodeBlock } from '../commands/markdownBlockCommands';

const SRC = '# Title\n\nhello world\n\n- a\n- b\n';
function setup() {
  const r = buildLiveDoc(SRC);
  if (!r.ok) throw new Error('degraded');
  return EditorState.create({ doc: r.doc, schema: liveSchema, plugins: [dirtyTrackingPlugin()] });
}
function cursorInBlock(s: EditorState, index: number): EditorState {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += s.doc.child(i).nodeSize;
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos + 1, pos + 1)));
}
function apply(s: EditorState, cmd: Command): EditorState {
  let next = s; cmd(s, (tr) => { next = s.apply(tr); }); return next;
}
const flavor = detectFlavor(SRC, 'markdown');

describe('block transform write-back (no-beautify)', () => {
  it('para→H3 changes only that block; all others byte-identical', () => {
    let s = apply(cursorInBlock(setup(), 1), setHeading(3));
    const dirty = getDirtyBlockIds(s);
    expect(dirty.size).toBe(1);
    expect(writeBack(s.doc, SRC, dirty, flavor)).toBe('# Title\n\n### hello world\n\n- a\n- b\n');
  });
  it('para→blockquote changes only that block', () => {
    let s = apply(cursorInBlock(setup(), 1), toggleBlockquote);
    const dirty = getDirtyBlockIds(s);
    expect(dirty.size).toBe(1);
    expect(writeBack(s.doc, SRC, dirty, flavor)).toBe('# Title\n\n> hello world\n\n- a\n- b\n');
  });
  it('para→codeBlock changes only that block', () => {
    let s = apply(cursorInBlock(setup(), 1), toggleCodeBlock);
    const dirty = getDirtyBlockIds(s);
    expect(dirty.size).toBe(1);
    expect(writeBack(s.doc, SRC, dirty, flavor)).toBe('# Title\n\n```\nhello world\n```\n\n- a\n- b\n');
  });
});
