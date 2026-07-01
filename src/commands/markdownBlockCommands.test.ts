import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { liveSchema } from '../views/liveSchema';
import { buildLiveDoc } from '../views/liveModel';
import {
  BLOCK_TRANSFORM, currentBlockType, blockActive, canTransform,
  setHeading, setParagraph, toggleCodeBlock,
} from './markdownBlockCommands';

const { heading, codeBlock, paragraph } = liveSchema.nodes;

function stateOf(src: string): EditorState {
  const r = buildLiveDoc(src);
  if (!r.ok) throw new Error('degraded');
  return EditorState.create({ doc: r.doc, schema: liveSchema });
}
function cursorInBlock(s: EditorState, index: number): EditorState {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += s.doc.child(i).nodeSize;
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos + 1, pos + 1)));
}
function selectAll(s: EditorState): EditorState {
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, s.doc.content.size - 1)));
}
function run(s: EditorState, cmd: Command): { ok: boolean; state: EditorState; meta: unknown } {
  let next = s; let meta: unknown;
  const ok = cmd(s, (tr) => { meta = tr.getMeta(BLOCK_TRANSFORM); next = s.apply(tr); });
  return { ok, state: next, meta };
}

describe('currentBlockType / blockActive / canTransform', () => {
  it('reports the cursor block type', () => {
    expect(currentBlockType(cursorInBlock(stateOf('# H\n\np\n'), 0))).toBe('h1');
    expect(currentBlockType(cursorInBlock(stateOf('# H\n\np\n'), 1))).toBe('paragraph');
    expect(currentBlockType(cursorInBlock(stateOf('```\nx\n```\n'), 0))).toBe('codeBlock');
    expect(blockActive(cursorInBlock(stateOf('# H\n'), 0), 'h1')).toBe(true);
  });
  it('canTransform is false inside a verbatim block', () => {
    // a GFM table → verbatim atom in liveModel
    const s = stateOf('| a | b |\n| - | - |\n| 1 | 2 |\n');
    // select the verbatim node
    const sel = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 0, 0)));
    // cursor at doc start lands before/at the verbatim atom
    expect(canTransform(sel)).toBe(false);
    expect(canTransform(cursorInBlock(stateOf('hello\n'), 0))).toBe(true);
  });
});

describe('type-change commands', () => {
  it('setHeading(2) turns a paragraph into an H2, preserving range attrs + tagging the tx', () => {
    const s = cursorInBlock(stateOf('# T\n\nhello\n'), 1);
    const orig = s.doc.child(1);
    const { ok, state, meta } = run(s, setHeading(2));
    expect(ok).toBe(true);
    expect(meta).toBe(true);
    const b = state.doc.child(1);
    expect(b.type).toBe(heading);
    expect(b.attrs.level).toBe(2);
    expect(b.attrs.blockId).toBe(orig.attrs.blockId);
    expect(b.attrs.srcFrom).toBe(orig.attrs.srcFrom);
    expect(b.attrs.srcTo).toBe(orig.attrs.srcTo);
    expect(b.textContent).toBe('hello');
  });
  it('setParagraph reverts a heading to a paragraph, preserving range attrs', () => {
    const s = cursorInBlock(stateOf('## title\n'), 0);
    const orig = s.doc.child(0);
    const b = run(s, setParagraph).state.doc.child(0);
    expect(b.type).toBe(paragraph);
    expect(b.attrs.blockId).toBe(orig.attrs.blockId);
  });
  it('toggleCodeBlock: paragraph→codeBlock strips marks + preserves range; toggling back →paragraph', () => {
    const s = cursorInBlock(stateOf('**b** and x\n'), 0);
    const orig = s.doc.child(0);
    const cb = run(s, toggleCodeBlock).state;
    const b = cb.doc.child(0);
    expect(b.type).toBe(codeBlock);
    expect(b.attrs.blockId).toBe(orig.attrs.blockId);
    let marks = 0; b.descendants((n) => { marks += n.marks.length; });
    expect(marks).toBe(0);            // codeBlock disallows marks — setBlockType strips them
    expect(b.textContent).toBe('b and x');
    // toggle back
    const back = run(cursorInBlock(cb, 0), toggleCodeBlock).state.doc.child(0);
    expect(back.type).toBe(paragraph);
  });
  it('is disabled (returns false) inside a verbatim block', () => {
    const s = stateOf('| a | b |\n| - | - |\n| 1 | 2 |\n');
    const sel = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 0, 0)));
    expect(setHeading(2)(sel)).toBe(false);
  });
  it('multi-block selection: setHeading transforms each block preserving its own range', () => {
    const s = selectAll(stateOf('one\n\ntwo\n'));
    const st = run(s, setHeading(2)).state;
    expect(st.doc.childCount).toBe(2);                 // count preserved
    expect(st.doc.child(0).type).toBe(heading);
    expect(st.doc.child(1).type).toBe(heading);
    expect(st.doc.child(0).attrs.blockId).not.toBe(st.doc.child(1).attrs.blockId); // each kept its own
  });
});
