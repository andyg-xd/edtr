import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { liveSchema } from '../views/liveSchema';
import { buildLiveDoc } from '../views/liveModel';
import { blockIdentityPlugin } from '../views/blockIdentity';
import { insertHorizontalRule, splitCommand, softBreakCommand } from './markdownStructureCommands';

function setup(src: string) {
  const r = buildLiveDoc(src);
  if (!r.ok) throw new Error('degraded');
  return EditorState.create({ doc: r.doc, schema: liveSchema, plugins: [blockIdentityPlugin()] });
}
function cursorInBlock(s: EditorState, index: number, offset = 1): EditorState {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += s.doc.child(i).nodeSize;
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos + offset)));
}
function apply(s: EditorState, cmd: Command): EditorState {
  let next = s; cmd(s, (tr) => { next = s.apply(tr); }); return next;
}

describe('insertHorizontalRule', () => {
  it('inserts an hr followed by an empty paragraph after the current block', () => {
    let s = cursorInBlock(setup('body\n'), 0);
    s = apply(s, insertHorizontalRule);
    expect(s.doc.childCount).toBe(3);
    expect(s.doc.child(0).type.name).toBe('paragraph'); // "body"
    expect(s.doc.child(1).type.name).toBe('horizontalRule');
    expect(s.doc.child(2).type.name).toBe('paragraph');
    expect(s.doc.child(2).content.size).toBe(0); // empty
  });
});

describe('splitCommand (Enter)', () => {
  it('splits a paragraph into two top-level paragraphs', () => {
    let s = cursorInBlock(setup('onetwo\n'), 0, 4); // cursor after "one"
    s = apply(s, splitCommand);
    expect(s.doc.childCount).toBe(2);
    expect(s.doc.child(0).textContent).toBe('one');
    expect(s.doc.child(1).textContent).toBe('two');
    // identity plugin gave the halves distinct ids
    expect(s.doc.child(0).attrs.blockId).not.toBe(s.doc.child(1).attrs.blockId);
  });

  it('at the end of a heading, the new block is a paragraph', () => {
    let s = setup('# Title\n');
    // cursor at end of heading content
    const end = 1 + s.doc.child(0).content.size;
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, end)));
    s = apply(s, splitCommand);
    expect(s.doc.childCount).toBe(2);
    expect(s.doc.child(0).type.name).toBe('heading');
    expect(s.doc.child(1).type.name).toBe('paragraph');
  });

  it('inside a code block, Enter inserts a newline (does not split)', () => {
    let s = setup('```\nab\n```\n');
    // cursor inside the code block content
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 2)));
    s = apply(s, splitCommand);
    expect(s.doc.childCount).toBe(1);
    expect(s.doc.child(0).type.name).toBe('codeBlock');
    expect(s.doc.child(0).textContent).toContain('\n');
  });
});

describe('softBreakCommand (Shift-Enter)', () => {
  it('inserts a hard break within the block (no split)', () => {
    let s = cursorInBlock(setup('onetwo\n'), 0, 4);
    s = apply(s, softBreakCommand);
    expect(s.doc.childCount).toBe(1);
    expect(s.doc.child(0).content.content.some((n) => n.type.name === 'hardBreak')).toBe(true);
  });
});
