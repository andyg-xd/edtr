import { describe, it, expect } from 'vitest';
import { buildOutline } from './outlineModel';

describe('buildOutline — Markdown', () => {
  it('returns one entry per ATX heading, in document order, with level and text', () => {
    const src = '# Title\n\nsome text\n\n## Section\n\n### Deep\n';
    const entries = buildOutline(src, 'markdown');
    expect(entries.map((e) => [e.level, e.text])).toEqual([
      [1, 'Title'],
      [2, 'Section'],
      [3, 'Deep'],
    ]);
  });

  it('records a source range that actually points at the heading', () => {
    const src = '# Title\n\n## Section\n';
    const [, second] = buildOutline(src, 'markdown');
    expect(src.slice(second.srcFrom, second.srcTo)).toBe('## Section');
  });

  it('reads setext headings too', () => {
    const src = 'Title\n=====\n\nSub\n---\n';
    expect(buildOutline(src, 'markdown').map((e) => e.level)).toEqual([1, 2]);
  });

  it('takes the heading text without its markup or inline formatting', () => {
    const src = '# A **bold** word\n';
    expect(buildOutline(src, 'markdown')[0].text).toBe('A bold word');
  });

  it('returns nothing for a document with no headings', () => {
    expect(buildOutline('just a paragraph\n', 'markdown')).toEqual([]);
  });
});

describe('buildOutline — HTML', () => {
  const page = (body: string) => `<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`;

  it('reads h1-h6 as levels 1-6', () => {
    const src = page('<h1>One</h1><h3>Three</h3>');
    expect(buildOutline(src, 'html').map((e) => e.level)).toEqual([1, 3]);
  });

  it('takes the heading text without its tags', () => {
    const src = page('<h2>A <em>stressed</em> word</h2>');
    expect(buildOutline(src, 'html')[0].text).toBe('A stressed word');
  });

  // THE case this phase is shaped around (spec §4.2): a heading inside a
  // <section> is NOT a direct child of <body>, so it carries no source range
  // in the live model. The outline must still find it, and must record the
  // SECTION as its block plus its ordinal within that section.
  it('finds headings nested inside a semantic container', () => {
    const src = page('<section><h2>First</h2><p>x</p><h3>Second</h3></section>');
    const entries = buildOutline(src, 'html');
    expect(entries.map((e) => e.text)).toEqual(['First', 'Second']);
    expect(entries.map((e) => e.ordinalInBlock)).toEqual([0, 1]);
    // Both share one containing block — the <section>.
    expect(entries[0].blockFrom).toBe(entries[1].blockFrom);
    expect(src.slice(entries[0].blockFrom, entries[0].blockTo).startsWith('<section>')).toBe(true);
  });

  it('numbers ordinals per block, restarting in the next one', () => {
    const src = page('<section><h2>A</h2><h2>B</h2></section><section><h2>C</h2></section>');
    expect(buildOutline(src, 'html').map((e) => e.ordinalInBlock)).toEqual([0, 1, 0]);
  });

  it('ignores a heading in the head, which is not document structure', () => {
    const src = '<!DOCTYPE html><html><head><title>t</title></head><body><h1>Real</h1></body></html>';
    expect(buildOutline(src, 'html').map((e) => e.text)).toEqual(['Real']);
  });
});
