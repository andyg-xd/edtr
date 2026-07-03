import { describe, it, expect } from 'vitest';
import { htmlSchema } from '../views/htmlSchema';
import { toLiveHtml } from '../views/htmlModel';
import { toSource } from '../views/ViewSync';
import { serializeHtmlDirty } from '../views/htmlSerializer';

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
