import { describe, it, expect } from 'vitest';
import { classifyPath } from './pathKind';

describe('classifyPath', () => {
  it('classifies documents by the D4 extension set', () => {
    expect(classifyPath('/a/b/notes.md')).toBe('document');
    expect(classifyPath('README.markdown')).toBe('document');
    expect(classifyPath('/x/page.HTML')).toBe('document'); // case-insensitive
    expect(classifyPath('x.htm')).toBe('document');
  });
  it('classifies images', () => {
    expect(classifyPath('/a/pic.png')).toBe('image');
    expect(classifyPath('shot.JPEG')).toBe('image');
  });
  it('treats .txt and unknowns as other (D4/D5: txt is not auto-open)', () => {
    expect(classifyPath('/a/log.txt')).toBe('other');
    expect(classifyPath('/a/archive.zip')).toBe('other');
    expect(classifyPath('/a/noext')).toBe('other');
  });
});
