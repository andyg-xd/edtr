// @vitest-environment jsdom
// src/commands/htmlStructureCommands.test.ts
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { toLiveHtml } from '../views/htmlModel';
import { htmlSchema } from '../views/htmlSchema';
import { splitCommand, softBreakCommand, insertHorizontalRule } from './htmlStructureCommands';

function stateAt(html: string, pos: number): EditorState {
  const res = toLiveHtml(html);
  if (!res.ok) throw new Error('degraded');
  const state = EditorState.create({ doc: res.doc, schema: htmlSchema });
  return state.apply(state.tr.setSelection(TextSelection.near(res.doc.resolve(pos))));
}

describe('htmlStructureCommands', () => {
  it('splitCommand splits a paragraph into two', () => {
    const s = stateAt('<html><body><p>hello</p></body></html>', 4); // between "hel" and "lo"
    let after = s;
    const ok = splitCommand(s, (tr) => { after = s.apply(tr); });
    expect(ok).toBe(true);
    expect(after.doc.childCount).toBe(2);
    expect(after.doc.child(0).type.name).toBe('paragraph');
    expect(after.doc.child(1).type.name).toBe('paragraph');
  });

  it('splitCommand at end of a heading yields a paragraph', () => {
    const res = toLiveHtml('<html><body><h2>hi</h2></body></html>');
    if (!res.ok) throw new Error('degraded');
    const endInHeading = res.doc.child(0).nodeSize - 1;
    let s = EditorState.create({ doc: res.doc, schema: htmlSchema });
    s = s.apply(s.tr.setSelection(TextSelection.near(res.doc.resolve(endInHeading))));
    let after = s;
    splitCommand(s, (tr) => { after = s.apply(tr); });
    expect(after.doc.childCount).toBe(2);
    expect(after.doc.child(1).type.name).toBe('paragraph');
  });

  it('splitCommand in a list item creates a new item (one list, two items)', () => {
    const s = stateAt('<html><body><ul><li>a</li></ul></body></html>', 3);
    let after = s;
    splitCommand(s, (tr) => { after = s.apply(tr); });
    expect(after.doc.childCount).toBe(1); // still one <ul>
    expect(after.doc.child(0).type.name).toBe('bulletList');
    expect(after.doc.child(0).childCount).toBe(2); // two <li>
  });

  it('softBreakCommand inserts a hardBreak (<br>)', () => {
    const s = stateAt('<html><body><p>hi</p></body></html>', 2);
    let after = s;
    softBreakCommand(s, (tr) => { after = s.apply(tr); });
    let found = false;
    after.doc.descendants((n) => { if (n.type.name === 'hardBreak') found = true; });
    expect(found).toBe(true);
  });

  it('insertHorizontalRule inserts hr + empty paragraph after the block', () => {
    const s = stateAt('<html><body><p>a</p></body></html>', 2);
    let after = s;
    insertHorizontalRule(s, (tr) => { after = s.apply(tr); });
    const types: string[] = [];
    after.doc.forEach((n) => types.push(n.type.name));
    expect(types).toEqual(['paragraph', 'horizontalRule', 'paragraph']);
  });
});
