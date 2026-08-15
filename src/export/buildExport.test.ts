// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toLive } from '../views/ViewSync';
import { buildExport } from './buildExport';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
  })));
});

describe('buildExport', () => {
  it('builds a standalone document for a Markdown file', async () => {
    const r = toLive('# Title\n\nBody text.\n', null);
    if (!r.ok) throw new Error('fixture failed');
    const { html } = await buildExport({
      format: 'markdown', doc: r.doc, source: '', title: 'Notes', resolve: () => null,
    });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<title>Notes</title>');
  });

  it('builds from the SOURCE for an HTML file, keeping its own style', async () => {
    const { html } = await buildExport({
      format: 'html', doc: null,
      source: '<html><head><style>.k{color:red}</style></head><body><p>x</p></body></html>',
      title: 'Page', resolve: () => null,
    });
    expect(html).toContain('.k{color:red}');
    expect(html).toContain('<p>x</p>');
  });

  it('surfaces a failed image embed all the way through to `failures`', async () => {
    // Hardcoding `failures: []` in buildExport would leave every OTHER test
    // in this file green — none of them look at a fetch that actually
    // rejects. `failures` is the user's only signal that an exported file
    // shipped with a broken image, so the pass-through from `inlineAssets`
    // to buildExport's return value needs its own proof.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const r = toLive('# Title\n\n![alt](pics/photo.png)\n', null);
    if (!r.ok) throw new Error('fixture failed');
    const { failures } = await buildExport({
      format: 'markdown', doc: r.doc, source: '', title: 't',
      resolve: (src) => `asset://${src}`,
    });
    expect(failures).toEqual(['pics/photo.png']);
  });
});
