import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (p: string) => `asset://localhost${p}`,
  invoke: vi.fn(),
}));

const { resolveExportAsset } = await import('./exportResolve');

describe('resolveExportAsset', () => {
  it('resolves a document-relative image to a fetchable asset URL', () => {
    expect(resolveExportAsset('pic.png', '/docs/note.md'))
      .toBe('asset://localhost/docs/pic.png');
  });

  it('returns null for a remote image, so it is left alone rather than fetched', () => {
    // The defect this prevents: handed the http URL, `inlineAssets` would try
    // to fetch it and log a failure the user then sees as "some images could
    // not be embedded" -- for an image that was never ours to embed.
    expect(resolveExportAsset('https://example.com/pic.png', '/docs/note.md')).toBeNull();
  });

  it('returns null when the document has no folder to resolve against', () => {
    // An unsaved document: there is no base path, so a relative src cannot be
    // turned into a file URL at all.
    expect(resolveExportAsset('pic.png', null)).toBeNull();
  });

  it('returns null for an empty src rather than a bogus URL', () => {
    expect(resolveExportAsset('', '/docs/note.md')).toBeNull();
  });
});
