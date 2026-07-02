// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((p: string) => `CONVERTED:${p}`),
  invoke: vi.fn(),
}));

import { resolveImageDisplaySrc, resolveAgainstDoc, dirName } from './imageAssets';

describe('dirName', () => {
  it('returns the parent folder of an absolute path', () => {
    expect(dirName('/a/b/notes.md')).toBe('/a/b');
  });
});

describe('resolveAgainstDoc', () => {
  it('joins a relative path onto the document folder', () => {
    expect(resolveAgainstDoc('notes.assets/p.png', '/a/b/notes.md')).toBe('/a/b/notes.assets/p.png');
  });
  it('resolves ../ segments', () => {
    expect(resolveAgainstDoc('../img/p.png', '/a/b/notes.md')).toBe('/a/img/p.png');
  });
  it('passes an already-absolute path through', () => {
    expect(resolveAgainstDoc('/abs/p.png', '/a/b/notes.md')).toBe('/abs/p.png');
  });
});

describe('resolveImageDisplaySrc', () => {
  it('passes remote + data URLs through unchanged', () => {
    expect(resolveImageDisplaySrc('https://x/y.png', '/a/b/n.md')).toBe('https://x/y.png');
    expect(resolveImageDisplaySrc('data:image/png;base64,AAA', '/a/b/n.md')).toBe('data:image/png;base64,AAA');
  });
  it('passes through when docPath is null', () => {
    expect(resolveImageDisplaySrc('n.assets/p.png', null)).toBe('n.assets/p.png');
  });
  it('converts a local relative path against the doc folder', () => {
    expect(resolveImageDisplaySrc('n.assets/p.png', '/a/b/n.md')).toBe('CONVERTED:/a/b/n.assets/p.png');
  });
});
