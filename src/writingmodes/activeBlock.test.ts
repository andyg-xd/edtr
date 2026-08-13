import { describe, it, expect } from 'vitest';
import { activeBlock } from './activeBlock';

const BLOCKS = [
  { from: 1, to: 10 },
  { from: 12, to: 20 },
  { from: 22, to: 30 },
];

describe('activeBlock', () => {
  it('finds the block containing the caret', () => {
    expect(activeBlock(BLOCKS, 15)).toEqual({ from: 12, to: 20 });
  });

  it('finds the first block', () => {
    expect(activeBlock(BLOCKS, 3)).toEqual({ from: 1, to: 10 });
  });

  it('finds the last block', () => {
    expect(activeBlock(BLOCKS, 25)).toEqual({ from: 22, to: 30 });
  });

  it('is inclusive at a block start', () => {
    expect(activeBlock(BLOCKS, 12)).toEqual({ from: 12, to: 20 });
  });

  it('is inclusive at a block end', () => {
    // A caret at the end of a paragraph is IN that paragraph. This assertion
    // is what fails if the range check uses `<` instead of `<=`.
    expect(activeBlock(BLOCKS, 20)).toEqual({ from: 12, to: 20 });
  });

  it('returns null between two blocks', () => {
    expect(activeBlock(BLOCKS, 11)).toBeNull();
  });

  it('returns null past the last block', () => {
    expect(activeBlock(BLOCKS, 99)).toBeNull();
  });

  it('returns null for an empty block list', () => {
    expect(activeBlock([], 0)).toBeNull();
  });
});
