import { describe, it, expect } from 'vitest';
import { activeEntryIndex } from './activeEntry';
import type { OutlineEntry } from './types';

const at = (srcFrom: number, srcTo: number): OutlineEntry => ({
  id: `n${srcFrom}`, level: 1, text: 't', srcFrom, srcTo, ordinalInBlock: 0, blockFrom: srcFrom, blockTo: srcTo,
});

describe('activeEntryIndex', () => {
  const entries = [at(0, 8), at(20, 30), at(50, 60)];

  it('is the heading whose section the caret sits in', () => {
    expect(activeEntryIndex(entries, 25)).toBe(1);
    expect(activeEntryIndex(entries, 40)).toBe(1);
  });

  it('is the heading itself when the caret is inside it', () => {
    expect(activeEntryIndex(entries, 3)).toBe(0);
  });

  it('is null before the first heading — that text belongs to no section', () => {
    expect(activeEntryIndex([at(10, 18)], 4)).toBeNull();
  });

  it('is the last heading when the caret is past all of them', () => {
    expect(activeEntryIndex(entries, 900)).toBe(2);
  });

  it('is exactly the heading the caret starts on, not the one before', () => {
    expect(activeEntryIndex(entries, 20)).toBe(1);
  });

  it('is null when there are no headings', () => {
    expect(activeEntryIndex([], 5)).toBeNull();
  });
});
