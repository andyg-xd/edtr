import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { htmlSchema } from '../views/htmlSchema';
import { toLiveHtml } from '../views/htmlModel';
import {
  toggleStrong, toggleUnderline, applyLink, removeLink, softBreak, markActive, insertImage,
} from './htmlInlineCommands';

function stateWithSelection(src: string, from: number, to: number) {
  const r = toLiveHtml(src);
  if (!r.ok) throw new Error(r.reason);
  const s0 = EditorState.create({ doc: r.doc, schema: htmlSchema });
  return s0.apply(s0.tr.setSelection(TextSelection.create(s0.doc, from, to)));
}

describe('htmlInlineCommands', () => {
  it('toggleStrong applies the strong mark to a selection', () => {
    const s = stateWithSelection('<html><body><p>hello</p></body></html>', 1, 6);
    let next: EditorState | null = null;
    toggleStrong(s, (tr) => { next = s.apply(tr); });
    expect(next).not.toBeNull();
    expect(markActive(next!, htmlSchema.marks.strong)).toBe(true);
  });

  it('toggleUnderline applies the underline mark', () => {
    const s = stateWithSelection('<html><body><p>hello</p></body></html>', 1, 6);
    let next: EditorState | null = null;
    toggleUnderline(s, (tr) => { next = s.apply(tr); });
    expect(markActive(next!, htmlSchema.marks.underline)).toBe(true);
  });

  it('applyLink wraps the selection in a link mark with href in the bag', () => {
    const s = stateWithSelection('<html><body><p>hello</p></body></html>', 1, 6);
    let next: EditorState | null = null;
    applyLink('https://a.test', 'hello')(s, (tr) => { next = s.apply(tr); });
    const link = htmlSchema.marks.link;
    expect(markActive(next!, link)).toBe(true);
    const marks = next!.doc.child(0).firstChild!.marks;
    expect((link.isInSet(marks)!.attrs.htmlAttrs as any).href).toBe('https://a.test');
  });

  it('removeLink lifts an existing link mark', () => {
    let s = stateWithSelection('<html><body><p>hello</p></body></html>', 1, 6);
    applyLink('https://a.test', 'hello')(s, (tr) => { s = s.apply(tr); });
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, 6)));
    let next: EditorState | null = null;
    removeLink(s, (tr) => { next = s.apply(tr); });
    expect(markActive(next!, htmlSchema.marks.link)).toBe(false);
  });

  it('softBreak inserts a hardBreak node', () => {
    const s = stateWithSelection('<html><body><p>ab</p></body></html>', 2, 2);
    let next: EditorState | null = null;
    softBreak(s, (tr) => { next = s.apply(tr); });
    let found = false;
    next!.doc.child(0).forEach((n) => { if (n.type.name === 'hardBreak') found = true; });
    expect(found).toBe(true);
  });
});

function stateAt(html: string): EditorState {
  const res = toLiveHtml(html);
  if (!res.ok) throw new Error('degraded');
  let state = EditorState.create({ doc: res.doc, schema: htmlSchema });
  return state.apply(state.tr.setSelection(TextSelection.near(res.doc.resolve(1))));
}

describe('htmlInlineCommands.insertImage', () => {
  it('inserts an inline image with a verbatim src + render-only displaySrc', () => {
    const s = stateAt('<html><body><p>hi</p></body></html>');
    let after = s;
    const ok = insertImage('pics/a.png', 'alt text', 'asset://x/a.png')(s, (tr) => { after = s.apply(tr); });
    expect(ok).toBe(true);
    let img: import('prosemirror-model').Node | null = null;
    after.doc.descendants((n) => { if (n.type.name === 'image') img = n; });
    expect(img!.attrs.htmlAttrs).toEqual({ src: 'pics/a.png', alt: 'alt text' });
    expect(img!.attrs.displaySrc).toBe('asset://x/a.png');
  });

  it('returns false inside a code block', () => {
    const s = stateAt('<html><body><pre><code>x</code></pre></body></html>');
    expect(insertImage('a.png')(s, () => {})).toBe(false);
  });
});
