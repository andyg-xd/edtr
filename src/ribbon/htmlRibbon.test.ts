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
  it('exposes exactly the six inline controls in order', () => {
    expect(htmlRibbon.map((c) => c.id)).toEqual(['bold', 'italic', 'underline', 'strike', 'code', 'link']);
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
