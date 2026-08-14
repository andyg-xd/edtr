// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inlineAssets } from './inlineAssets';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('missing')) throw new Error('not found');
    return { ok: true, blob: async () => new Blob([PNG], { type: 'image/png' }) };
  }));
});

describe('inlineAssets', () => {
  it('replaces a local image with a data URI', async () => {
    const { html, failures } = await inlineAssets(
      '<p><img src="pics/a.png" alt="a"></p>',
      (src) => `asset://${src}`,
    );
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).not.toContain('pics/a.png');
    expect(failures).toEqual([]);
  });

  it('leaves a remote image alone', async () => {
    const { html } = await inlineAssets(
      '<p><img src="https://example.com/a.png"></p>',
      () => null,
    );
    expect(html).toContain('https://example.com/a.png');
  });

  it('keeps the original src and reports a failure when the file cannot be read', async () => {
    // Never fail the whole export for one bad image, and never silently emit a
    // file with an invisible hole in it.
    const { html, failures } = await inlineAssets(
      '<p><img src="pics/missing.png"></p>',
      (src) => `asset://${src}`,
    );
    expect(html).toContain('src="pics/missing.png"');
    expect(failures).toEqual(['pics/missing.png']);
  });

  it('leaves an image that already carries a data: URI untouched', async () => {
    // `resolve` belongs to a later task and there is no guarantee it treats a
    // `data:` src as "not a local file" — so the guard has to live IN
    // inlineAssets, not be borrowed from the caller. Proven with a `resolve`
    // that would happily "resolve" anything: if inlineAssets ever called it
    // for a data: src, this test would embed a second-generation data URI (or
    // fail outright) instead of leaving the original byte-for-byte.
    const dataUri = 'data:image/png;base64,AAAA';
    const resolve = vi.fn(() => 'asset://should-not-be-used');
    const { html, failures } = await inlineAssets(`<p><img src="${dataUri}"></p>`, resolve);
    expect(html).toContain(`src="${dataUri}"`);
    expect(failures).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('reports a failure (never silently succeeds) when fetch resolves but the response is not ok', async () => {
    // A real failed HTTP response — e.g. a 404 — resolves without throwing.
    // `res.ok === false` must be treated as a failure too, not passed through
    // to `res.blob()` where it could produce a data URI encoding an error
    // page/body instead of the image.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, blob: async () => new Blob([PNG]) })));
    const { html, failures } = await inlineAssets(
      '<p><img src="pics/gone.png"></p>',
      (src) => `asset://${src}`,
    );
    expect(html).toContain('src="pics/gone.png"');
    expect(failures).toEqual(['pics/gone.png']);
  });

  it('embeds more than one local image and leaves each failure independent', async () => {
    // A single-image test can't distinguish "this image failed" from "the
    // whole function bailed after the first image" — a loop with an early
    // return, or a shared mutable index bug, would still pass every test
    // above. Two locals plus a remote, where one local succeeds and one
    // fails, proves each `<img>` is handled independently.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('bad')) return { ok: false, blob: async () => new Blob([PNG]) };
      return { ok: true, blob: async () => new Blob([PNG], { type: 'image/png' }) };
    }));
    const { html, failures } = await inlineAssets(
      '<p><img src="pics/good.png"><img src="pics/bad.png"><img src="https://example.com/r.png"></p>',
      (src) => (src.startsWith('http') ? null : `asset://${src}`),
    );
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain('src="pics/bad.png"');
    expect(html).toContain('https://example.com/r.png');
    expect(failures).toEqual(['pics/bad.png']);
  });
});
