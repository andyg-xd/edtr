import { describe, it, expect } from 'vitest';
import { nestOutline } from './outlineNesting';
import type { OutlineEntry } from './types';

const entry = (level: number, text: string): OutlineEntry => ({
  id: text, level, text, srcFrom: 0, srcTo: 1, ordinalInBlock: 0, blockFrom: 0, blockTo: 1,
});

describe('nestOutline', () => {
  it('nests a lower level under the one above it', () => {
    const tree = nestOutline([entry(1, 'A'), entry(2, 'B')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((c) => c.entry.text)).toEqual(['B']);
  });

  it('keeps siblings at the same level side by side', () => {
    const tree = nestOutline([entry(2, 'A'), entry(2, 'B')]);
    expect(tree.map((n) => n.entry.text)).toEqual(['A', 'B']);
  });

  // Real documents skip levels. An h1 followed by an h3 must not produce a
  // broken tree or an invented h2.
  it('survives a skipped level', () => {
    const tree = nestOutline([entry(1, 'A'), entry(3, 'C')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((c) => c.entry.text)).toEqual(['C']);
  });

  it('handles a document that starts deep', () => {
    const tree = nestOutline([entry(3, 'C'), entry(4, 'D')]);
    expect(tree.map((n) => n.entry.text)).toEqual(['C']);
    expect(tree[0].children.map((c) => c.entry.text)).toEqual(['D']);
  });

  it('pops back out to a shallower level', () => {
    const tree = nestOutline([entry(1, 'A'), entry(2, 'B'), entry(1, 'C')]);
    expect(tree.map((n) => n.entry.text)).toEqual(['A', 'C']);
  });

  it('returns nothing for no entries', () => {
    expect(nestOutline([])).toEqual([]);
  });
});
