import { describe, it, expect } from 'vitest';
import { identityMap, mapStart, mapEnd, type OffsetMap } from './types';

// Two runs with a POSITIONAL GAP between them — what an excluded atom (an
// image) between two text runs produces. Offsets are contiguous; positions
// are not. Getting this wrong is the whole reason the map exists.
const gapped: OffsetMap = {
  runs: [
    { from: 0, len: 2, pos: 1 },   // "ca" at positions 1..3
    { from: 2, len: 1, pos: 10 },  // "t"  at position  10
  ],
};

describe('identityMap', () => {
  it('maps offset straight to position', () => {
    const m = identityMap(5);
    expect(mapStart(m, 0)).toBe(0);
    expect(mapStart(m, 4)).toBe(4);
    expect(mapEnd(m, 5)).toBe(5);
  });

  it('has no runs for empty text', () => {
    expect(identityMap(0).runs).toEqual([]);
  });
});

describe('mapStart', () => {
  it('maps into the run that contains the offset', () => {
    expect(mapStart(gapped, 0)).toBe(1);
    expect(mapStart(gapped, 1)).toBe(2);
    expect(mapStart(gapped, 2)).toBe(10);
  });

  it('returns null past the end', () => {
    expect(mapStart(gapped, 3)).toBeNull();
  });
});

describe('mapEnd', () => {
  it('maps an END offset to the position after its last character', () => {
    // end=2 is the end of "ca" — position 3, NOT the start of the next run
    // at 10. An end offset belongs to the run holding offset-1.
    expect(mapEnd(gapped, 2)).toBe(3);
    expect(mapEnd(gapped, 3)).toBe(11);
  });

  it('returns null for an end of zero', () => {
    expect(mapEnd(gapped, 0)).toBeNull();
  });
});
