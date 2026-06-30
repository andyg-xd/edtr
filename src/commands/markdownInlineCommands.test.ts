import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { liveSchema } from '../views/liveSchema';
import { buildLiveDoc } from '../views/liveModel';
import {
  markActive, canInsert, getMarkRange,
  toggleStrong, toggleEm, toggleStrike, toggleCode,
  canLink, applyLink, removeLink, insertImage,
} from './markdownInlineCommands';

const { strong, em, strikethrough, code, link } = liveSchema.marks;
const { image } = liveSchema.nodes;

function stateOf(src: string): EditorState {
  const r = buildLiveDoc(src);
  if (!r.ok) throw new Error('degraded');
  return EditorState.create({ doc: r.doc, schema: liveSchema });
}
function selectFirstBlock(s: EditorState): EditorState {
  const b = s.doc.child(0);
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, 1 + b.content.size)));
}
function cursorAt(s: EditorState, pos: number): EditorState {
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos, pos)));
}
function run(s: EditorState, cmd: Command): EditorState | null {
  let next: EditorState | null = null;
  const ok = cmd(s, (tr) => { next = s.apply(tr); });
  return ok ? next : null;
}
function blockHasMark(s: EditorState, markType: typeof strong): boolean {
  return s.doc.rangeHasMark(1, 1 + s.doc.child(0).content.size, markType);
}

describe('markActive', () => {
  it('is false on plain text, true after toggling strong over a selection', () => {
    const s = selectFirstBlock(stateOf('hello\n'));
    expect(markActive(s, strong)).toBe(false);
    const next = run(s, toggleStrong)!;
    expect(markActive(next, strong)).toBe(true);
  });
});

describe('toggle mark commands', () => {
  it('toggleStrong/Em/Strike/Code each apply their mark over the selection', () => {
    for (const [cmd, mark] of [[toggleStrong, strong], [toggleEm, em], [toggleStrike, strikethrough], [toggleCode, code]] as const) {
      const next = run(selectFirstBlock(stateOf('hello\n')), cmd)!;
      expect(blockHasMark(next, mark)).toBe(true);
    }
  });
  it('toggling twice removes the mark', () => {
    let s = selectFirstBlock(stateOf('hello\n'));
    s = run(s, toggleStrong)!;
    const sel = TextSelection.create(s.doc, 1, 1 + s.doc.child(0).content.size);
    s = s.apply(s.tr.setSelection(sel));
    s = run(s, toggleStrong)!;
    expect(blockHasMark(s, strong)).toBe(false);
  });
  it('is disabled (dry-run false) inside a code block', () => {
    const s = cursorAt(stateOf('```\ncode\n```\n'), 2);
    expect(toggleStrong(s)).toBe(false);
    expect(toggleEm(s)).toBe(false);
  });
});

describe('canInsert / image', () => {
  it('canInsert(image) is true in a paragraph, false in a code block', () => {
    expect(canInsert(cursorAt(stateOf('hi\n'), 2), image)).toBe(true);
    expect(canInsert(cursorAt(stateOf('```\nx\n```\n'), 2), image)).toBe(false);
  });
  it('insertImage inserts an inline image node', () => {
    const next = run(cursorAt(stateOf('hi\n'), 2), insertImage('pic.png', 'a'))!;
    let found = false;
    next.doc.descendants((n) => { if (n.type === image) found = true; });
    expect(found).toBe(true);
  });
  it('insertImage with empty src is a no-op (returns false)', () => {
    expect(insertImage('')(cursorAt(stateOf('hi\n'), 2))).toBe(false);
  });
});

describe('link commands', () => {
  it('canLink is true in a paragraph', () => {
    expect(canLink(selectFirstBlock(stateOf('hello\n')))).toBe(true);
  });
  it('applyLink replaces the selection with linked text', () => {
    const next = run(selectFirstBlock(stateOf('hello\n')), applyLink('http://x.test', 'Anthropic'))!;
    expect(next.doc.child(0).textContent).toBe('Anthropic');
    expect(next.doc.rangeHasMark(1, 1 + next.doc.child(0).content.size, link)).toBe(true);
  });
  it('applyLink with empty href is a no-op (returns false)', () => {
    expect(applyLink('', 'x')(selectFirstBlock(stateOf('hello\n')))).toBe(false);
  });
  it('applyLink with empty text falls back to href as visible text', () => {
    const next = run(selectFirstBlock(stateOf('hello\n')), applyLink('http://x.test', ''))!;
    expect(next.doc.child(0).textContent).toBe('http://x.test');
    expect(next.doc.rangeHasMark(1, 1 + next.doc.child(0).content.size, link)).toBe(true);
  });
  it('getMarkRange finds the whole link around a collapsed cursor (mid)', () => {
    const s = cursorAt(stateOf('[link](http://x.test)\n'), 3);
    expect(getMarkRange(s.selection.$from, link)).toEqual({ from: 1, to: 5 });
  });
  it('getMarkRange finds the whole link at the exact right edge of the mark (pos 5)', () => {
    // pos 5 is immediately after the "k" — the right boundary of the link node.
    // childAfter returns {node:null} here; the fix must fall back to childBefore.
    const s = cursorAt(stateOf('[link](http://x.test)\n'), 5);
    expect(getMarkRange(s.selection.$from, link)).toEqual({ from: 1, to: 5 });
  });
  it('markActive is true for a cursor inside a link', () => {
    const s = cursorAt(stateOf('[link](http://x.test)\n'), 3);
    expect(markActive(s, link)).toBe(true);
  });
  it('removeLink clears the link around a collapsed cursor', () => {
    const s = cursorAt(stateOf('[link](http://x.test)\n'), 3);
    expect(markActive(s, link)).toBe(true);
    const next = run(s, removeLink)!;
    expect(next.doc.rangeHasMark(1, 5, link)).toBe(false);
  });
  it('removeLink is a no-op when no link is present (returns false)', () => {
    expect(removeLink(cursorAt(stateOf('hello\n'), 2))).toBe(false);
  });
});
