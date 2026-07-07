import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { htmlSchema } from '../views/htmlSchema';
import { toLiveHtml } from '../views/htmlModel';
import { htmlRibbon } from './htmlRibbon';

function selState(src: string, from: number, to: number) {
  const r = toLiveHtml(src);
  if (!r.ok) throw new Error(r.reason);
  const s = EditorState.create({ doc: r.doc, schema: htmlSchema });
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to)));
}

describe('htmlRibbon', () => {
  it('exposes the inline controls followed by block controls in order', () => {
    expect(htmlRibbon.map((c) => c.id)).toEqual(
      ['bold', 'italic', 'underline', 'strike', 'code', 'link', 'image', 'heading', 'codeBlock', 'blockquote', 'bulletList', 'orderedList', 'horizontalRule', 'insertTable'],
    );
  });

  it('bold isActive reflects the strong mark at the selection', () => {
    const s = selState('<html><body><p>hi</p></body></html>', 1, 3);
    const bold = htmlRibbon.find((c) => c.id === 'bold')!;
    expect(bold.isActive(s)).toBe(false);
    let next = s;
    (bold.action as any).run(s, (tr: any) => { next = s.apply(tr); });
    expect(bold.isActive(next)).toBe(true);
  });

  it('the link control is a link popover with a removeLink whenActiveRun', () => {
    const link = htmlRibbon.find((c) => c.id === 'link')!;
    expect(link.action.kind).toBe('popover');
    expect((link.action as any).popover).toBe('link');
    expect((link.action as any).whenActiveRun).toBeTypeOf('function');
  });
});

describe('htmlRibbon — 4c block controls', () => {
  it('includes a heading dropdown with Paragraph + H1–H6', () => {
    const heading = htmlRibbon.find((c) => c.id === 'heading');
    expect(heading?.action.kind).toBe('dropdown');
    if (heading?.action.kind === 'dropdown') {
      expect(heading.action.options.map((o) => o.value)).toEqual(
        ['paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      );
    }
  });
  it('includes a code-block toggle command', () => {
    const cb = htmlRibbon.find((c) => c.id === 'codeBlock');
    expect(cb?.action.kind).toBe('command');
  });

  it('includes a horizontal-rule command control', () => {
    const hr = htmlRibbon.find((c) => c.id === 'horizontalRule');
    expect(hr?.action.kind).toBe('command');
  });

  it('includes an image popover control', () => {
    const img = htmlRibbon.find((c) => c.id === 'image');
    expect(img?.action.kind).toBe('popover');
    if (img?.action.kind === 'popover') expect(img.action.popover).toBe('image');
  });
});

describe('htmlRibbon — 4d-ii blockquote/list controls', () => {
  it('exposes blockquote / bulletList / orderedList command controls', () => {
    for (const id of ['blockquote', 'bulletList', 'orderedList']) {
      const c = htmlRibbon.find((x) => x.id === id);
      expect(c, id).toBeTruthy();
      expect(c!.action.kind).toBe('command');
    }
  });

  it('blockquote control is enabled on a paragraph and active inside a blockquote', () => {
    const bq = htmlRibbon.find((x) => x.id === 'blockquote')!;
    expect(bq.isEnabled(selState('<html><body><p>x</p></body></html>', 1, 1))).toBe(true);
    expect(bq.isActive(selState('<html><body><blockquote><p>q</p></blockquote></body></html>', 1, 1))).toBe(true);
    expect(bq.isActive(selState('<html><body><p>x</p></body></html>', 1, 1))).toBe(false);
  });

  it('bulletList control is enabled on a paragraph and active inside a bullet list', () => {
    const b = htmlRibbon.find((x) => x.id === 'bulletList')!;
    expect(b.isEnabled(selState('<html><body><p>x</p></body></html>', 1, 1))).toBe(true);
    expect(b.isActive(selState('<html><body><ul><li><p>i</p></li></ul></body></html>', 1, 1))).toBe(true);
  });

  it('orderedList control is enabled on a paragraph and active inside an ordered list', () => {
    const o = htmlRibbon.find((x) => x.id === 'orderedList')!;
    expect(o.isEnabled(selState('<html><body><p>x</p></body></html>', 1, 1))).toBe(true);
    expect(o.isActive(selState('<html><body><ol><li><p>i</p></li></ol></body></html>', 1, 1))).toBe(true);
  });
});
