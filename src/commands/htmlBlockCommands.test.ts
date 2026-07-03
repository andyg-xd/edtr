// @vitest-environment jsdom
// src/commands/htmlBlockCommands.test.ts
import { describe, it, expect } from 'vitest';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { toLiveHtml } from '../views/htmlModel';
import { htmlSchema } from '../views/htmlSchema';
import {
  currentBlockType, canTransform, setHeading, setParagraph, toggleCodeBlock,
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
