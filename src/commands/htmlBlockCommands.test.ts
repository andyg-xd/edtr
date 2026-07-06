// @vitest-environment jsdom
// src/commands/htmlBlockCommands.test.ts
import { describe, it, expect } from 'vitest';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { toLiveHtml } from '../views/htmlModel';
import { htmlSchema } from '../views/htmlSchema';
import {
  currentBlockType, canTransform, canWrap, setHeading, setParagraph, toggleCodeBlock, toggleBlockquote,
  toggleBulletList, toggleOrderedList, sinkListItemCmd, liftListItemCmd,
} from './htmlBlockCommands';

function stateAt(html: string, blockIndex = 0): EditorState {
  const res = toLiveHtml(html);
  if (!res.ok) throw new Error('degraded');
  let pos = 0;
  for (let i = 0; i < blockIndex; i++) pos += res.doc.child(i).nodeSize;
  let state = EditorState.create({ doc: res.doc, schema: htmlSchema });
  state = state.apply(state.tr.setSelection(TextSelection.near(res.doc.resolve(pos + 1))));
  return state;
}

// helper: select from inside block `fromIdx` to inside block `toIdx` (top level)
function selectAcross(html: string, fromIdx: number, toIdx: number): EditorState {
  const res = toLiveHtml(html);
  if (!res.ok) throw new Error('degraded');
  let a = 0; for (let i = 0; i < fromIdx; i++) a += res.doc.child(i).nodeSize;
  let b = 0; for (let i = 0; i < toIdx; i++) b += res.doc.child(i).nodeSize;
  let state = EditorState.create({ doc: res.doc, schema: htmlSchema });
  state = state.apply(state.tr.setSelection(
    TextSelection.between(res.doc.resolve(a + 1), res.doc.resolve(b + 1)),
  ));
  return state;
}

describe('htmlBlockCommands', () => {
  it('setHeading converts a paragraph → heading, preserving htmlAttrs + blockId', () => {
    const s = stateAt('<html><body><p class="lead" id="x">hi</p><p>two</p></body></html>', 0);
    let after = s;
    const ok = setHeading(2)(s, (tr) => { after = s.apply(tr); });
    expect(ok).toBe(true);
    const b = after.doc.child(0);
    expect(b.type.name).toBe('heading');
    expect(b.attrs.level).toBe(2);
    expect(b.attrs.htmlAttrs).toEqual({ class: 'lead', id: 'x' });
    expect(b.attrs.blockId).toBe('h0');
  });

  it('setParagraph converts a heading → paragraph', () => {
    const s = stateAt('<html><body><h2>hi</h2></body></html>', 0);
    let after = s;
    setParagraph(s, (tr) => { after = s.apply(tr); });
    expect(after.doc.child(0).type.name).toBe('paragraph');
  });

  it('toggleCodeBlock converts a paragraph → codeBlock', () => {
    const s = stateAt('<html><body><p>hi</p></body></html>', 0);
    let after = s;
    toggleCodeBlock(s, (tr) => { after = s.apply(tr); });
    expect(after.doc.child(0).type.name).toBe('codeBlock');
  });

  it('canTransform is false on a verbatim atom (table)', () => {
    const res = toLiveHtml('<html><body><p>ok</p><table><tr><td>c</td></tr></table></body></html>');
    if (!res.ok) throw new Error('degraded');
    const pos = res.doc.child(0).nodeSize; // position just before the table (block 1)
    let state = EditorState.create({ doc: res.doc, schema: htmlSchema });
    state = state.apply(state.tr.setSelection(NodeSelection.create(res.doc, pos)));
    expect(currentBlockType(state)).toBe('other');
    expect(canTransform(state)).toBe(false);
  });
});

describe('currentBlockType + canWrap (4d-ii)', () => {
  it('reports blockquote / bulletList / orderedList for container blocks', () => {
    const bq = stateAt('<html><body><blockquote><p>q</p></blockquote></body></html>', 0);
    expect(currentBlockType(bq)).toBe('blockquote');
    const ul = stateAt('<html><body><ul><li>a</li></ul></body></html>', 0);
    expect(currentBlockType(ul)).toBe('bulletList');
    const ol = stateAt('<html><body><ol><li>a</li></ol></body></html>', 0);
    expect(currentBlockType(ol)).toBe('orderedList');
  });

  it('canWrap is true for a paragraph and for an existing blockquote/list', () => {
    expect(canWrap(stateAt('<html><body><p>x</p></body></html>', 0))).toBe(true);
    expect(canWrap(stateAt('<html><body><blockquote><p>q</p></blockquote></body></html>', 0))).toBe(true);
    expect(canWrap(stateAt('<html><body><ul><li>a</li></ul></body></html>', 0))).toBe(true);
  });

  it('canWrap is false on a verbatim atom (table)', () => {
    const res = toLiveHtml('<html><body><table><tr><td colspan="2">c</td></tr></table></body></html>');
    if (!res.ok) throw new Error('degraded');
    let state = EditorState.create({ doc: res.doc, schema: htmlSchema });
    state = state.apply(state.tr.setSelection(NodeSelection.create(res.doc, 0)));
    expect(canWrap(state)).toBe(false);
  });
});

describe('toggleBlockquote (4d-ii)', () => {
  it('wraps the cursor block into a blockquote', () => {
    const s = stateAt('<html><body><p>a</p><p>b</p></body></html>', 0);
    let after = s;
    expect(toggleBlockquote(s, (tr) => { after = s.apply(tr); })).toBe(true);
    expect(after.doc.child(0).type.name).toBe('blockquote');
    expect(after.doc.child(0).firstChild!.type.name).toBe('paragraph');
    expect(after.doc.child(1).type.name).toBe('paragraph'); // second block untouched
  });

  it('groups a two-block selection into ONE blockquote with both children', () => {
    const s = selectAcross('<html><body><p>a</p><p>b</p></body></html>', 0, 1);
    let after = s;
    toggleBlockquote(s, (tr) => { after = s.apply(tr); });
    expect(after.doc.childCount).toBe(1);
    expect(after.doc.child(0).type.name).toBe('blockquote');
    expect(after.doc.child(0).childCount).toBe(2);
  });

  it('dissolves a blockquote when toggled again', () => {
    const s = stateAt('<html><body><blockquote><p>a</p><p>b</p></blockquote></body></html>', 0);
    let after = s;
    expect(toggleBlockquote(s, (tr) => { after = s.apply(tr); })).toBe(true);
    expect(after.doc.child(0).type.name).toBe('paragraph');
    expect(after.doc.child(1).type.name).toBe('paragraph');
  });
});

describe('toggle lists (4d-ii)', () => {
  it('wraps the cursor block into a one-item bullet list', () => {
    const s = stateAt('<html><body><p>a</p></body></html>', 0);
    let after = s;
    expect(toggleBulletList(s, (tr) => { after = s.apply(tr); })).toBe(true);
    expect(after.doc.child(0).type.name).toBe('bulletList');
    expect(after.doc.child(0).childCount).toBe(1);
    expect(after.doc.child(0).firstChild!.type.name).toBe('listItem');
  });

  it('groups a two-block selection into ONE ordered list with two items', () => {
    const s = selectAcross('<html><body><p>a</p><p>b</p></body></html>', 0, 1);
    let after = s;
    toggleOrderedList(s, (tr) => { after = s.apply(tr); });
    expect(after.doc.childCount).toBe(1);
    expect(after.doc.child(0).type.name).toBe('orderedList');
    expect(after.doc.child(0).childCount).toBe(2);
  });

  it('dissolves a bullet list when toggled again', () => {
    const s = stateAt('<html><body><ul><li>a</li><li>b</li></ul></body></html>', 0);
    let after = s;
    expect(toggleBulletList(s, (tr) => { after = s.apply(tr); })).toBe(true);
    expect(after.doc.child(0).type.name).toBe('paragraph');
    expect(after.doc.child(1).type.name).toBe('paragraph');
  });
});

describe('list indent/outdent (4d-ii)', () => {
  it('sinkListItemCmd returns false when not in a list', () => {
    const s = stateAt('<html><body><p>a</p></body></html>', 0);
    expect(sinkListItemCmd(s)).toBe(false);
  });

  it('sinkListItemCmd nests the second item under the first', () => {
    const s = stateAt('<html><body><ul><li>one</li><li>two</li></ul></body></html>', 0);
    // put the cursor inside the SECOND list item
    const list = s.doc.child(0);
    const secondItemInner = 1 /* into list */ + list.firstChild!.nodeSize + 1;
    let cur = s.apply(s.tr.setSelection(TextSelection.near(s.doc.resolve(secondItemInner))));
    let after = cur;
    expect(sinkListItemCmd(cur, (tr) => { after = cur.apply(tr); })).toBe(true);
    // first item now contains its paragraph + a nested list
    expect(after.doc.child(0).firstChild!.childCount).toBe(2);
  });

  it('liftListItemCmd returns false when not in a list', () => {
    const s = stateAt('<html><body><p>a</p></body></html>', 0);
    expect(liftListItemCmd(s)).toBe(false);
  });
});

describe('4d-ii bug fixes: nested-container blockquote + list-type switch', () => {
  // Bug B: cursor inside a paragraph nested in a <div>. The wrap must target the
  // TOP-LEVEL block (the div), not nest a blockquote inside it — otherwise the
  // top-level-only toggle-off never detects it and clicks nest infinitely.
  it('toggleBlockquote wraps the TOP-LEVEL container (never nests inside a <div>)', () => {
    const res = toLiveHtml('<html><body><div><p>x</p></div></body></html>');
    if (!res.ok) throw new Error('degraded');
    let s = EditorState.create({ doc: res.doc, schema: htmlSchema });
    s = s.apply(s.tr.setSelection(TextSelection.near(res.doc.resolve(3)))); // inside inner <p>
    expect(currentBlockType(s)).toBe('other'); // top-level is the div
    toggleBlockquote(s, (tr) => { s = s.apply(tr); });
    expect(s.doc.child(0).type.name).toBe('blockquote');        // top-level blockquote…
    expect(s.doc.child(0).firstChild!.type.name).toBe('div');   // …wrapping the div (not nested inside it)
    expect(currentBlockType(s)).toBe('blockquote');
  });

  it('toggleBlockquote is toggleable on nested-container content (re-toggle dissolves, no infinite nesting)', () => {
    const res = toLiveHtml('<html><body><div><p>x</p></div></body></html>');
    if (!res.ok) throw new Error('degraded');
    let s = EditorState.create({ doc: res.doc, schema: htmlSchema });
    s = s.apply(s.tr.setSelection(TextSelection.near(res.doc.resolve(3))));
    toggleBlockquote(s, (tr) => { s = s.apply(tr); }); // wrap
    s = s.apply(s.tr.setSelection(TextSelection.near(s.doc.resolve(3)))); // back inside
    toggleBlockquote(s, (tr) => { s = s.apply(tr); }); // dissolve
    expect(s.doc.child(0).type.name).toBe('div'); // back to the div…
    expect(s.doc.child(0).firstChild!.type.name).toBe('paragraph'); // …directly holding the <p> (NO nested blockquote)
    expect(s.doc.childCount).toBe(1);
  });

  // Bug A: switching list types directly (no dissolve-first).
  it('toggleOrderedList converts a bullet list to ordered in place, preserving items', () => {
    const s = stateAt('<html><body><ul><li>a</li><li>b</li></ul></body></html>', 0);
    let after = s;
    expect(toggleOrderedList(s, (tr) => { after = s.apply(tr); })).toBe(true);
    expect(after.doc.child(0).type.name).toBe('orderedList');
    expect(after.doc.child(0).childCount).toBe(2); // both items preserved
    expect(after.doc.child(0).attrs.blockId).toBe(s.doc.child(0).attrs.blockId); // same block (rides reconciler)
  });

  it('toggleBulletList converts an ordered list to bullet in place', () => {
    const s = stateAt('<html><body><ol><li>a</li></ol></body></html>', 0);
    let after = s;
    expect(toggleBulletList(s, (tr) => { after = s.apply(tr); })).toBe(true);
    expect(after.doc.child(0).type.name).toBe('bulletList');
  });

  // Same nested-container class as blockquote: a list wrap on content nested in a
  // <div> must target the TOP-LEVEL container, not nest a list inside it.
  it('toggleBulletList wraps the TOP-LEVEL container (never nests a list inside a <div>)', () => {
    const res = toLiveHtml('<html><body><div><p>x</p></div></body></html>');
    if (!res.ok) throw new Error('degraded');
    let s = EditorState.create({ doc: res.doc, schema: htmlSchema });
    s = s.apply(s.tr.setSelection(TextSelection.near(res.doc.resolve(3)))); // inside inner <p>
    toggleBulletList(s, (tr) => { s = s.apply(tr); });
    expect(s.doc.child(0).type.name).toBe('bulletList');            // top-level list…
    expect(s.doc.child(0).firstChild!.firstChild!.type.name).toBe('div'); // …item wraps the div
    expect(currentBlockType(s)).toBe('bulletList');                 // so re-toggle can dissolve it
  });

  // A selection spanning a list INTO a sibling block groups (wrapIntoList), rather
  // than the convert branch silently converting only the list and dropping the rest.
  it('toggleOrderedList on a selection spanning a <ul> into a trailing <p> groups both (non-destructive)', () => {
    const res = toLiveHtml('<html><body><ul><li>a</li></ul><p>tail</p></body></html>');
    if (!res.ok) throw new Error('degraded');
    let s = EditorState.create({ doc: res.doc, schema: htmlSchema });
    const ulSize = res.doc.child(0).nodeSize;
    s = s.apply(s.tr.setSelection(TextSelection.between(res.doc.resolve(3), res.doc.resolve(ulSize + 2))));
    expect(toggleOrderedList(s, (tr) => { s = s.apply(tr); })).toBe(true);
    expect(s.doc.childCount).toBe(1);
    expect(s.doc.child(0).type.name).toBe('orderedList');   // grouped, not a silent list-only convert
    expect(s.doc.textContent).toContain('a');               // no content dropped…
    expect(s.doc.textContent).toContain('tail');            // …the trailing paragraph is included
  });
});
