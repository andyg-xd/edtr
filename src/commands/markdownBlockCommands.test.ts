import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { liveSchema } from '../views/liveSchema';
import { buildLiveDoc } from '../views/liveModel';
import {
  currentBlockType, blockActive, canTransform,
  setHeading, setParagraph, toggleCodeBlock,
  toggleBlockquote, toggleBulletList, toggleOrderedList, toggleTaskList,
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
function run(s: EditorState, cmd: Command): { ok: boolean; state: EditorState } {
  let next = s;
  const ok = cmd(s, (tr) => { next = s.apply(tr); });
  return { ok, state: next };
}

describe('currentBlockType / blockActive / canTransform', () => {
  it('reports the cursor block type', () => {
    expect(currentBlockType(cursorInBlock(stateOf('# H\n\np\n'), 0))).toBe('h1');
    expect(currentBlockType(cursorInBlock(stateOf('# H\n\np\n'), 1))).toBe('paragraph');
    expect(currentBlockType(cursorInBlock(stateOf('```\nx\n```\n'), 0))).toBe('codeBlock');
    expect(blockActive(cursorInBlock(stateOf('# H\n'), 0), 'h1')).toBe(true);
  });
  it('canTransform is false inside a verbatim block', () => {
    // a raw HTML block → verbatim atom in liveModel
    const s = stateOf('<div>x</div>\n');
    // select the verbatim node
    const sel = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 0, 0)));
    // cursor at doc start lands before/at the verbatim atom
    expect(canTransform(sel)).toBe(false);
    expect(canTransform(cursorInBlock(stateOf('hello\n'), 0))).toBe(true);
  });
});

describe('type-change commands', () => {
  it('setHeading(2) turns a paragraph into an H2, preserving range attrs', () => {
    const s = cursorInBlock(stateOf('# T\n\nhello\n'), 1);
    const orig = s.doc.child(1);
    const { ok, state } = run(s, setHeading(2));
    expect(ok).toBe(true);
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
    const s = stateOf('<div>x</div>\n');
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

describe('wrap / unwrap commands', () => {
  const { blockquote, bulletList, orderedList, paragraph } = liveSchema.nodes;

  it('toggleBlockquote wraps a paragraph; the blockquote inherits the range attrs; toggling again unwraps', () => {
    const s = cursorInBlock(stateOf('quote me\n\ntail\n'), 0);
    const orig = s.doc.child(0);
    const wrapped = run(s, toggleBlockquote).state;
    const bq = wrapped.doc.child(0);
    expect(bq.type).toBe(blockquote);
    expect(bq.attrs.blockId).toBe(orig.attrs.blockId);
    expect(bq.attrs.srcFrom).toBe(orig.attrs.srcFrom);
    expect(bq.firstChild!.type).toBe(paragraph);
    // toggle off → back to a top-level paragraph with the range attrs restored
    const back = run(cursorInBlock(wrapped, 0), toggleBlockquote).state.doc.child(0);
    expect(back.type).toBe(paragraph);
    expect(back.attrs.blockId).toBe(orig.attrs.blockId);
  });

  it('toggleBulletList wraps a paragraph into a one-item list; toggling off restores the paragraph', () => {
    const s = cursorInBlock(stateOf('item\n'), 0);
    const orig = s.doc.child(0);
    const wrapped = run(s, toggleBulletList).state;
    const list = wrapped.doc.child(0);
    expect(list.type).toBe(bulletList);
    expect(list.attrs.blockId).toBe(orig.attrs.blockId);
    expect(list.firstChild!.type).toBe(liveSchema.nodes.listItem);
    const back = run(cursorInBlock(wrapped, 0), toggleBulletList).state.doc.child(0);
    expect(back.type).toBe(paragraph);
    expect(back.attrs.blockId).toBe(orig.attrs.blockId);
  });

  it('toggleOrderedList — range-attr + round-trip: inherits blockId/srcFrom; toggling off restores paragraph', () => {
    const s = cursorInBlock(stateOf('item\n'), 0);
    const orig = s.doc.child(0);
    const wrapped = run(s, toggleOrderedList).state;
    const list = wrapped.doc.child(0);
    expect(list.type).toBe(orderedList);
    expect(list.attrs.blockId).toBe(orig.attrs.blockId);
    expect(list.attrs.srcFrom).toBe(orig.attrs.srcFrom);
    // toggle off → back to paragraph with original blockId
    const back = run(cursorInBlock(wrapped, 0), toggleOrderedList).state.doc.child(0);
    expect(back.type).toBe(paragraph);
    expect(back.attrs.blockId).toBe(orig.attrs.blockId);
  });

  it('toggleTaskList produces a bulletList whose item is checkbox-bearing (checked=false)', () => {
    const list = run(cursorInBlock(stateOf('todo\n'), 0), toggleTaskList).state.doc.child(0);
    expect(list.type).toBe(bulletList);
    expect(list.firstChild!.attrs.checked).toBe(false);
  });

  it('toggleTaskList — round-trip: toggling off restores a paragraph with the original blockId', () => {
    const s = cursorInBlock(stateOf('todo\n'), 0);
    const orig = s.doc.child(0);
    const wrapped = run(s, toggleTaskList).state;
    // toggle off → back to paragraph
    const back = run(cursorInBlock(wrapped, 0), toggleTaskList).state.doc.child(0);
    expect(back.type).toBe(paragraph);
    expect(back.attrs.blockId).toBe(orig.attrs.blockId);
  });

});

describe('multi-block grouping', () => {
  const { blockquote, bulletList, orderedList, listItem, paragraph } = liveSchema.nodes;

  it('blockquote: wraps 3 selected blocks into ONE blockquote with 3 children', () => {
    const s = selectAll(stateOf('a\n\nb\n\nc\n'));
    const st = run(s, toggleBlockquote).state;
    expect(st.doc.childCount).toBe(1);
    expect(st.doc.child(0).type).toBe(blockquote);
    expect(st.doc.child(0).childCount).toBe(3);
  });

  it('blockquote: unwrap dissolves a multi-child quote back to 3 top-level blocks', () => {
    const wrapped = run(selectAll(stateOf('a\n\nb\n\nc\n')), toggleBlockquote).state;
    const back = run(cursorInBlock(wrapped, 0), toggleBlockquote).state;
    expect(back.doc.childCount).toBe(3);
    expect(back.doc.child(0).type).toBe(paragraph);
    expect(back.doc.child(2).type).toBe(paragraph);
  });

  it('bullet list: wraps 3 selected blocks into ONE list with 3 items', () => {
    const st = run(selectAll(stateOf('a\n\nb\n\nc\n')), toggleBulletList).state;
    expect(st.doc.childCount).toBe(1);
    expect(st.doc.child(0).type).toBe(bulletList);
    expect(st.doc.child(0).childCount).toBe(3);
    expect(st.doc.child(0).child(0).type).toBe(listItem);
  });

  it('ordered list: wraps 3 selected blocks into ONE list with 3 items', () => {
    const st = run(selectAll(stateOf('a\n\nb\n\nc\n')), toggleOrderedList).state;
    expect(st.doc.childCount).toBe(1);
    expect(st.doc.child(0).type).toBe(orderedList);
    expect(st.doc.child(0).childCount).toBe(3);
  });

  it('task list: wraps 3 blocks into 3 items, each checked:false', () => {
    const st = run(selectAll(stateOf('a\n\nb\n\nc\n')), toggleTaskList).state;
    expect(st.doc.child(0).type).toBe(bulletList);
    expect(st.doc.child(0).childCount).toBe(3);
    st.doc.child(0).forEach((item) => expect(item.attrs.checked).toBe(false));
  });

  it('list: unwrap dissolves a multi-item list back to 3 top-level blocks', () => {
    const wrapped = run(selectAll(stateOf('a\n\nb\n\nc\n')), toggleBulletList).state;
    const back = run(cursorInBlock(wrapped, 0), toggleBulletList).state;
    expect(back.doc.childCount).toBe(3);
    expect(back.doc.child(0).type).toBe(paragraph);
  });
});
