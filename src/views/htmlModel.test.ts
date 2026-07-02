// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { toLiveHtml } from './htmlModel';

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
});
