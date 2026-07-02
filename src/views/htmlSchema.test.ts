// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { htmlSchema } from './htmlSchema';

describe('htmlSchema', () => {
  it('renders a paragraph with its html attributes', () => {
    const n = htmlSchema.nodes.paragraph.create({ htmlAttrs: { class: 'lead', id: 'p1' } }, [
      htmlSchema.text('hi'),
    ]);
    const spec = htmlSchema.nodes.paragraph.spec.toDOM!(n) as [string, Record<string, string>, number];
    expect(spec[0]).toBe('p');
    expect(spec[1]).toEqual({ class: 'lead', id: 'p1' });
  });

  it('renders a heading at its level with attrs', () => {
    const n = htmlSchema.nodes.heading.create({ level: 2, htmlAttrs: { class: 'h' } }, [htmlSchema.text('t')]);
    const spec = htmlSchema.nodes.heading.spec.toDOM!(n) as [string, Record<string, string>, number];
    expect(spec[0]).toBe('h2');
    expect(spec[1]).toEqual({ class: 'h' });
  });

  it('verbatim atom renders its raw html', () => {
    const n = htmlSchema.nodes.verbatim.create({ raw: '<table><tr><td>x</td></tr></table>' });
    expect(htmlSchema.nodes.verbatim.spec.toDOM).toBeTruthy();
    expect(n.attrs.raw).toContain('<table>');
  });

  it('supports the html inline marks', () => {
    for (const m of ['strong', 'em', 'underline', 'strike', 'code', 'link', 'span']) {
      expect(htmlSchema.marks[m]).toBeTruthy();
    }
    const link = htmlSchema.marks.link.create({ htmlAttrs: { href: 'https://x', class: 'l' } });
    const spec = htmlSchema.marks.link.spec.toDOM!(link, true) as [string, Record<string, string>, number];
    expect(spec[0]).toBe('a');
    expect(spec[1]).toEqual({ href: 'https://x', class: 'l' });
  });
});
