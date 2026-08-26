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
