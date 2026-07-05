// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { toLiveHtml } from './htmlModel';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (p: string) => `asset://localhost${p}`,
  invoke: vi.fn(),
}));

const find = (doc: any, type: string): any => {
  let hit: any = null;
  doc.descendants((n: any) => { if (!hit && n.type.name === type) hit = n; });
  return hit;
};

describe('toLiveHtml', () => {
  it('builds a paragraph from body content, preserving attrs', () => {
    const res = toLiveHtml('<html><body><p class="lead">hello</p></body></html>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = find(res.doc, 'paragraph');
    expect(p).toBeTruthy();
    expect(p.attrs.htmlAttrs).toEqual({ class: 'lead' });
    expect(p.textContent).toBe('hello');
  });

  it('collects <style> text', () => {
    const res = toLiveHtml('<html><head><style>.x{color:red}</style></head><body><p>y</p></body></html>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.styleText).toContain('.x{color:red}');
  });

  it('falls back to verbatim for a table', () => {
    const res = toLiveHtml('<html><body><table><tr><td>c</td></tr></table></body></html>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const v = find(res.doc, 'verbatim');
    expect(v).toBeTruthy();
    expect(v.attrs.raw).toContain('<table>');
  });

  it('maps inline marks (strong/em/a)', () => {
    const res = toLiveHtml('<html><body><p>a <strong>b</strong> <a href="u">c</a></p></body></html>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = find(res.doc, 'paragraph');
    const markNames = new Set<string>();
    p.descendants((n: any) => n.marks.forEach((m: any) => markNames.add(m.type.name)));
    expect(markNames.has('strong')).toBe(true);
    expect(markNames.has('link')).toBe(true);
  });

  it('top-level body children carry source ranges', () => {
    const res = toLiveHtml('<html><body><p>one</p><p>two</p></body></html>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const first = res.doc.child(0);
    expect(first.attrs.srcTo).toBeGreaterThan(first.attrs.srcFrom);
    expect(first.attrs.blockId).toBeTruthy();
  });

  it('routes an unknown top-level container to a BLOCK verbatim (not squashed)', () => {
    const res = toLiveHtml('<html><body><details><p>x</p></details></body></html>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const top = res.doc.child(0);
    expect(top.type.name).toBe('verbatim');
    expect(top.attrs.raw).toContain('<details');
  });

  it('bare top-level text carries its real (non-zero) range', () => {
    const src = '<html><body>hello</body></html>';
    const res = toLiveHtml(src);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const first = res.doc.child(0);
    expect(first.attrs.srcTo).toBeGreaterThan(first.attrs.srcFrom);
    expect(src.slice(first.attrs.srcFrom, first.attrs.srcTo)).toContain('hello');
  });

  it('captures body and html attrs so body/html-scoped CSS can be reconstructed', () => {
    const res = toLiveHtml('<html class="h"><body class="dark" id="pg"><p>x</p></body></html>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.bodyAttrs).toEqual({ class: 'dark', id: 'pg' });
    expect(res.rootAttrs).toEqual({ class: 'h' });
  });
});

const findImage = (doc: any): any => {
  let hit: any = null;
  doc.descendants((n: any) => { if (!hit && n.type.name === 'image') hit = n; });
  return hit;
};

describe('toLiveHtml image displaySrc (local-<img> render fix)', () => {
  it('sets displaySrc for a relative local src when docPath is given', () => {
    const res = toLiveHtml('<html><body><p><img src="pics/a.png"></p></body></html>', '/docs/note.html');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const img = findImage(res.doc);
    expect(img.attrs.htmlAttrs.src).toBe('pics/a.png');          // verbatim
    expect(img.attrs.displaySrc).toBe('asset://localhost/docs/pics/a.png');
  });

  it('leaves displaySrc null for a data: URI', () => {
    const res = toLiveHtml('<html><body><p><img src="data:image/png;base64,AAAA"></p></body></html>', '/docs/note.html');
    if (!res.ok) return;
    expect(findImage(res.doc).attrs.displaySrc).toBeNull();
  });

  it('leaves displaySrc null when docPath is absent', () => {
    const res = toLiveHtml('<html><body><p><img src="pics/a.png"></p></body></html>');
    if (!res.ok) return;
    expect(findImage(res.doc).attrs.displaySrc).toBeNull();
  });
});

describe('horizontalRule model mapping', () => {
  it('maps a source <hr> to a horizontalRule block with a range', () => {
    const res = toLiveHtml('<html><body><p>a</p><hr><p>b</p></body></html>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const types: string[] = [];
    res.doc.forEach((n) => types.push(n.type.name));
    expect(types).toEqual(['paragraph', 'horizontalRule', 'paragraph']);
    const hr = res.doc.child(1);
    expect(hr.attrs.srcTo).toBeGreaterThan(hr.attrs.srcFrom); // real range, not 0/0
  });
});

describe('semantic containers (4d-iii)', () => {
  const TAGS = ['section', 'main', 'article', 'header', 'footer', 'nav', 'aside', 'figure', 'figcaption'];
  for (const tag of TAGS) {
    it(`types <${tag}> with block children as an editable container`, () => {
      const res = toLiveHtml(`<html><body><${tag}><p>x</p></${tag}></body></html>`);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const top = res.doc.child(0);
      expect(top.type.name).toBe('container');
      expect(top.attrs.tag).toBe(tag);
      expect(top.firstChild!.type.name).toBe('paragraph');
      expect(top.attrs.srcFrom).toBeGreaterThan(0); // real top-level range (reconciler byte-slices it)
    });
  }

  it('nests containers', () => {
    const res = toLiveHtml('<html><body><section><div><p>x</p></div></section></body></html>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const section = res.doc.child(0);
    expect(section.type.name).toBe('container');
    expect(section.firstChild!.type.name).toBe('div');
    expect(section.firstChild!.firstChild!.type.name).toBe('paragraph');
  });

  it('preserves a container class attr', () => {
    const res = toLiveHtml('<html><body><section class="hero"><p>x</p></section></body></html>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.doc.child(0).attrs.htmlAttrs).toEqual({ class: 'hero' });
  });
});

describe('mixed inline+block content wrapping (4d-iii)', () => {
  it('wraps loose text in a mixed <div> as a synthetic paragraph', () => {
    const res = toLiveHtml('<html><body><div>text<p>a</p></div></body></html>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const div = res.doc.child(0);
    expect(div.type.name).toBe('div');
    expect(div.childCount).toBe(2);
    expect(div.child(0).type.name).toBe('paragraph');
    expect(div.child(0).textContent).toBe('text');
    expect(div.child(1).type.name).toBe('paragraph');
    expect(div.child(1).textContent).toBe('a');
  });

  it('makes a bare-inline <blockquote> editable (one synthetic paragraph)', () => {
    const res = toLiveHtml('<html><body><blockquote>quote</blockquote></body></html>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const bq = res.doc.child(0);
    expect(bq.type.name).toBe('blockquote');
    expect(bq.childCount).toBe(1);
    expect(bq.firstChild!.type.name).toBe('paragraph');
    expect(bq.firstChild!.textContent).toBe('quote');
  });

  it('does not create whitespace-only paragraphs between block children', () => {
    const res = toLiveHtml('<html><body><section>\n  <p>a</p>\n  <p>b</p>\n</section></body></html>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const section = res.doc.child(0);
    expect(section.childCount).toBe(2); // exactly [p, p] — no whitespace paragraphs
    expect(section.child(0).type.name).toBe('paragraph');
    expect(section.child(1).type.name).toBe('paragraph');
  });

  it('preserves inline marks inside a wrapped run', () => {
    const res = toLiveHtml('<html><body><div>a <strong>b</strong> c<p>tail</p></div></body></html>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const div = res.doc.child(0);
    expect(div.child(0).type.name).toBe('paragraph');
    expect(div.child(0).textContent).toBe('a b c');
    let bHasStrong = false;
    div.child(0).descendants((n: any) => {
      if (n.isText && n.text === 'b' && n.marks.some((m: any) => m.type.name === 'strong')) bHasStrong = true;
    });
    expect(bHasStrong).toBe(true);
  });

  it('keeps whitespace between adjacent inline elements in a wrapped run', () => {
    const res = toLiveHtml('<html><body><div><strong>a</strong> <strong>b</strong></div></body></html>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const div = res.doc.child(0);
    expect(div.child(0).type.name).toBe('paragraph');
    expect(div.child(0).textContent).toBe('a b'); // the space between the two <strong>s is preserved
  });
});

describe('list item content (4d-iii childBlocks ripple)', () => {
  it('models a mixed <li> (loose text + block child) as separate paragraphs', () => {
    const res = toLiveHtml('<html><body><ul><li>text<p>a</p></li></ul></body></html>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const li = res.doc.child(0).firstChild!; // ul → first listItem
    expect(li.type.name).toBe('listItem');
    expect(li.childCount).toBe(2);
    expect(li.child(0).type.name).toBe('paragraph');
    expect(li.child(0).textContent).toBe('text');
    expect(li.child(1).type.name).toBe('paragraph');
    expect(li.child(1).textContent).toBe('a');
  });

  it('keeps a plain bare-inline <li> as a single synthetic paragraph (unchanged)', () => {
    const res = toLiveHtml('<html><body><ul><li>only</li></ul></body></html>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const li = res.doc.child(0).firstChild!;
    expect(li.childCount).toBe(1);
    expect(li.firstChild!.type.name).toBe('paragraph');
    expect(li.firstChild!.textContent).toBe('only');
  });
});
