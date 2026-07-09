import { describe, it, expect } from 'vitest';
import { isEmptyWindow, type OpenPayload } from './openPayload';

describe('isEmptyWindow', () => {
  it('is true only with zero docs and no folder', () => {
    expect(isEmptyWindow(0, false)).toBe(true);
    expect(isEmptyWindow(1, false)).toBe(false); // has a doc
    expect(isEmptyWindow(0, true)).toBe(false);  // has a folder context
    expect(isEmptyWindow(2, true)).toBe(false);
  });
});

describe('OpenPayload', () => {
  it('accepts both variants (type-level; compiles)', () => {
    const files: OpenPayload = { kind: 'files', paths: ['/a.md'] };
    const folder: OpenPayload = { kind: 'folder', path: '/dir' };
    expect(files.kind).toBe('files');
    expect(folder.kind).toBe('folder');
  });
});
