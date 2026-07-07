// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { htmlSchema, mergeTextAlign } from './htmlSchema';

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

  it('sanitizes dangerous htmlAttrs at render time without touching the node attrs', () => {
    const n = htmlSchema.nodes.image.create({ htmlAttrs: { src: 'x', onerror: 'boom()' } });
    const spec = htmlSchema.nodes.image.spec.toDOM!(n) as [string, Record<string, string>];
    expect(spec[0]).toBe('img');
    expect(spec[1].src).toBe('x');
    expect(spec[1]).not.toHaveProperty('onerror');
    // the node's own attrs stay verbatim (model unaffected)
    expect(n.attrs.htmlAttrs).toEqual({ src: 'x', onerror: 'boom()' });
  });

  it('sanitizes a javascript: href on the link mark, model stays verbatim', () => {
    const link = htmlSchema.marks.link.create({ htmlAttrs: { href: 'javascript:alert(1)' } });
    const spec = htmlSchema.marks.link.spec.toDOM!(link, true) as [string, Record<string, string>, number];
    expect(spec[1]).not.toHaveProperty('href');
    // mark attrs stay verbatim (model unaffected — render-only sanitize)
    expect(link.attrs.htmlAttrs).toEqual({ href: 'javascript:alert(1)' });
  });

  it('verbatim toDOM strips iframe/srcdoc, <script>, and onerror before rendering', () => {
    const n = htmlSchema.nodes.verbatim.create({
      raw: '<iframe srcdoc="<script>x</script>"></iframe><img src=x onerror="boom()">',
    });
    const dom = htmlSchema.nodes.verbatim.spec.toDOM!(n) as HTMLElement;
    const container = document.createElement('div');
    container.appendChild(dom);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img!.hasAttribute('onerror')).toBe(false);
    // raw attr itself stays verbatim (model unaffected — render-only sanitize)
    expect(n.attrs.raw).toContain('onerror');
    expect(n.attrs.raw).toContain('iframe');
  });

  describe('htmlSchema image displaySrc', () => {
    it('toDOM uses displaySrc when set, htmlAttrs.src otherwise', () => {
      const withD = htmlSchema.nodes.image.create({ htmlAttrs: { src: 'pic.png', alt: 'a' }, displaySrc: 'asset://x/pic.png' });
      const dom = withD.type.spec.toDOM!(withD) as [string, Record<string, string>];
      expect(dom[1].src).toBe('asset://x/pic.png');
      expect(dom[1].alt).toBe('a');

      const raw = htmlSchema.nodes.image.create({ htmlAttrs: { src: 'pic.png' } });
      const dom2 = raw.type.spec.toDOM!(raw) as [string, Record<string, string>];
      expect(dom2[1].src).toBe('pic.png');
    });
  });

  it('horizontalRule renders as <hr>', () => {
    const hr = htmlSchema.nodes.horizontalRule.create();
    const dom = hr.type.spec.toDOM!(hr) as [string];
    expect(dom[0]).toBe('hr');
  });

  it('renders a container by its tag attr with its html attributes', () => {
    const n = htmlSchema.nodes.container.create({ tag: 'section', htmlAttrs: { class: 'x' } }, [
      htmlSchema.nodes.paragraph.create({ htmlAttrs: {} }, [htmlSchema.text('t')]),
    ]);
    const spec = htmlSchema.nodes.container.spec.toDOM!(n) as [string, Record<string, string>, number];
    expect(spec[0]).toBe('section');
    expect(spec[1]).toEqual({ class: 'x' });
  });

  it('renders a cell as <td> or <th> by the header attr, with its html attrs', () => {
    const p = () => htmlSchema.nodes.paragraph.create({ htmlAttrs: {} }, [htmlSchema.text('x')]);
    const td = htmlSchema.nodes.tableCell.create({ header: false, htmlAttrs: {} }, p());
    const th = htmlSchema.nodes.tableCell.create({ header: true, htmlAttrs: { class: 'k' } }, p());
    expect((htmlSchema.nodes.tableCell.spec.toDOM!(td) as [string])[0]).toBe('td');
    const thSpec = htmlSchema.nodes.tableCell.spec.toDOM!(th) as [string, Record<string, string>, number];
    expect(thSpec[0]).toBe('th');
    expect(thSpec[1]).toEqual({ class: 'k' });
  });

  it('renders a row as <tr> and the table shell as <table> wrapping <tbody>', () => {
    const row = htmlSchema.nodes.tableRow.create(
      { htmlAttrs: { class: 'r' } },
      htmlSchema.nodes.tableCell.create({ header: false, htmlAttrs: {} }, htmlSchema.nodes.paragraph.create({ htmlAttrs: {} })),
    );
    const rowSpec = htmlSchema.nodes.tableRow.spec.toDOM!(row) as [string, Record<string, string>, number];
    expect(rowSpec[0]).toBe('tr');
    expect(rowSpec[1]).toEqual({ class: 'r' });
    const t = htmlSchema.nodes.table.createAndFill()!;
    const tSpec = htmlSchema.nodes.table.spec.toDOM!(t) as [string, Record<string, string>, [string, number]];
    expect(tSpec[0]).toBe('table');
    expect(tSpec[2]).toEqual(['tbody', 0]);
  });

  describe('tableCell alignment', () => {
    const { tableCell, paragraph } = htmlSchema.nodes;

    it('toDOM renders text-align in the cell style when align is set', () => {
      const cell = tableCell.create({ header: false, align: 'center' }, paragraph.create({ htmlAttrs: {} }));
      const dom = tableCell.spec.toDOM!(cell) as [string, Record<string, string>, number];
      expect(dom[0]).toBe('td');
      expect(dom[1].style).toContain('text-align:center');
    });

    it('toDOM omits text-align when align is null', () => {
      const cell = tableCell.create({ header: true, align: null }, paragraph.create({ htmlAttrs: {} }));
      const dom = tableCell.spec.toDOM!(cell) as [string, Record<string, string>, number];
      expect(dom[0]).toBe('th');
      expect(dom[1].style ?? '').not.toContain('text-align');
    });

    it('mergeTextAlign appends onto an empty style and replaces an existing text-align', () => {
      expect(mergeTextAlign(undefined, 'center')).toBe('text-align:center');
      expect(mergeTextAlign('color:red; text-align:left', 'right')).toBe('color:red; text-align:right');
    });
  });
});
