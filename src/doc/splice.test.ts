import { describe, it, expect } from 'vitest';
import { spliceSource } from './splice';

describe('spliceSource', () => {
  it('returns the source unchanged when there are no edits (no-op)', () => {
    const src = 'hello world\n';
    expect(spliceSource(src, [])).toBe(src);
  });

  it('replaces a single range and leaves all other bytes identical', () => {
    const src = 'hello world';
    const out = spliceSource(src, [{ start: 6, end: 11, text: 'there' }]);
    expect(out).toBe('hello there');
    expect(out.slice(0, 6)).toBe(src.slice(0, 6)); // prefix untouched
  });

  it('applies multiple non-overlapping edits regardless of input order', () => {
    const src = 'AAA BBB CCC';
    const out = spliceSource(src, [
      { start: 8, end: 11, text: 'ccc' },
      { start: 0, end: 3, text: 'aaa' },
    ]);
    expect(out).toBe('aaa BBB ccc');
    expect(out.slice(3, 8)).toBe(src.slice(3, 8)); // middle untouched
  });

  it('supports pure insertion (start === end)', () => {
    const src = 'ab';
    const out = spliceSource(src, [{ start: 1, end: 1, text: 'X' }]);
    expect(out).toBe('aXb');
  });

  it('throws on overlapping edits', () => {
    const src = 'abcdef';
    expect(() =>
      spliceSource(src, [
        { start: 0, end: 3, text: 'x' },
        { start: 2, end: 5, text: 'y' },
      ]),
    ).toThrow(/overlap/i);
  });
});
