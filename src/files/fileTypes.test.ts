import { describe, it, expect } from 'vitest';
import { formatForPath, basename } from './fileTypes';

describe('formatForPath', () => {
  it('maps markdown extensions', () => {
    expect(formatForPath('/x/a.md')).toBe('markdown');
    expect(formatForPath('/x/a.markdown')).toBe('markdown');
    expect(formatForPath('/x/A.MD')).toBe('markdown');
  });
  it('maps html extensions', () => {
    expect(formatForPath('/x/a.html')).toBe('html');
    expect(formatForPath('/x/a.htm')).toBe('html');
  });
  it('falls back to plaintext for everything else', () => {
    expect(formatForPath('/x/a.txt')).toBe('plaintext');
    expect(formatForPath('/x/README')).toBe('plaintext');
  });
});

describe('basename', () => {
  it('returns the final path segment', () => {
    expect(basename('/Users/x/notes/todo.md')).toBe('todo.md');
    expect(basename('todo.md')).toBe('todo.md');
  });
});
