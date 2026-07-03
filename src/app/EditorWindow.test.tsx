import { describe, it, expect, vi } from 'vitest';
import { htmlSchema } from '../views/htmlSchema';
import { toLiveHtml } from '../views/htmlModel';
import { toSource, htmlWriteBack } from '../views/ViewSync';
import { serializeHtmlDirty } from '../views/htmlSerializer';
import { toLiveHtml as _toLiveHtml } from '../views/htmlModel';
import { htmlSchema as _htmlSchema } from '../views/htmlSchema';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (p: string) => `asset://localhost${p}`,
  invoke: vi.fn(),
}));

// Guards the exact wiring EditorWindow's HTML flush uses: toSource + serializeHtmlDirty.
describe('HTML flush wiring', () => {
  it('writes back only the dirty block, byte-identical elsewhere', () => {
    const SRC = `<html><body><h1>T</h1><p>old</p></body></html>`;
    const r = toLiveHtml(SRC);
    if (!r.ok) throw new Error(r.reason);
    const p = r.doc.child(1);
    const edited = htmlSchema.node('paragraph', p.attrs, [htmlSchema.text('new')]);
    const doc2 = htmlSchema.node('doc', null, [r.doc.child(0), edited]);
    const out = toSource(doc2, SRC, serializeHtmlDirty(new Set([p.attrs.blockId as string])));
    expect(out).toBe('<html><body><h1>T</h1><p>new</p></body></html>');
  });
});

// Contract: the HTML flush path reconstructs via htmlWriteBack. A structural
// change (a new top-level block whose id isn't in the baseline) round-trips
// with the untouched block byte-identical — which the old per-block splice
// could not express. (Full flow is GUI-validated; this pins the reconciler contract.)
it('htmlWriteBack round-trips a new block with untouched neighbors byte-identical', () => {
  const src = '<!doctype html>\n<html>\n<body>\n<p>keep</p>\n</body>\n</html>\n';
  const r = _toLiveHtml(src);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const added = _htmlSchema.node('paragraph', { htmlAttrs: {}, srcFrom: 0, srcTo: 0, blockId: 'new-0' }, [_htmlSchema.text('added')]);
  const doc = _htmlSchema.node('doc', null, [r.doc.child(0), added]);
  const out = htmlWriteBack(doc, src, new Set(['new-0']), r.doc);
  expect(out).toContain('<p>keep</p>\n<p>added</p>');
  expect(out.startsWith('<!doctype html>\n')).toBe(true);
});

// Wiring-contract: the HTML live-doc memo resolves images against the doc path.
// (Full drag-drop/paste behavior is GUI-validated — Tauri events/IPC aren't modeled in jsdom.)
describe('EditorWindow HTML image wiring', () => {
  it('toLiveHtml resolves image displaySrc when given a docPath (EditorWindow contract)', () => {
    // EditorWindow calls toLiveHtml(session.text, session.path). Prove the call shape
    // produces a resolvable displaySrc so a local <img> renders in the HTML Live view.
    const res = toLiveHtml('<html><body><p><img src="a.png"></p></body></html>', '/docs/n.html');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let img: any = null;
    res.doc.descendants((n: any) => { if (!img && n.type.name === 'image') img = n; });
    expect(img.attrs.htmlAttrs.src).toBe('a.png');
    expect(img.attrs.displaySrc).not.toBeNull();
  });
});
