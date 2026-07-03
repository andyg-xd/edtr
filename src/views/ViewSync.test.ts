// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { toLive, toSource, writeBack, serializeDirty, htmlWriteBack } from './ViewSync';
import { buildLiveDoc } from './liveModel';
import { detectFlavor } from '../doc/flavor';
import { liveSchema } from './liveSchema';
import { toLiveHtml } from './htmlModel';
import { htmlSchema } from './htmlSchema';

function liveDoc(src: string) {
  const r = toLive(src);
  if (!r.ok) throw new Error('degraded');
  return r.doc;
}

describe('ViewSync round-trip (read-only, no edits)', () => {
  const samples = [
    '# Title\n\nA paragraph with **bold** and *em*.\n\n- one\n- two\n',
    '> quote\n\n```js\nconst x = 1;\n```\n\n---\n',
    '| a | b |\n| - | - |\n| 1 | 2 |\n', // table → verbatim, must still round-trip
    'no trailing newline',
  ];

  it('toSource with no serializer returns the source byte-for-byte', () => {
    for (const src of samples) {
      expect(toSource(liveDoc(src), src)).toBe(src);
    }
  });

  it('splicing every block back as its own raw slice reproduces the source exactly', () => {
    // Proves the block ranges tile/splice correctly — the plumbing 3b depends on.
    for (const src of samples) {
      const d = liveDoc(src);
      const rawPassthrough = (block: any) => src.slice(block.attrs.srcFrom, block.attrs.srcTo);
      expect(toSource(d, src, rawPassthrough)).toBe(src);
    }
  });

  it('splices a single changed block into its range, leaving the rest verbatim', () => {
    const src = 'alpha\n\nbeta\n';
    const d = liveDoc(src);
    const secondId = d.child(1).attrs.blockId;
    const serialize = (block: any) => (block.attrs.blockId === secondId ? 'BETA' : null);
    expect(toSource(d, src, serialize)).toBe('alpha\n\nBETA\n');
  });
});

function docFor(src: string) {
  const r = buildLiveDoc(src);
  if (!r.ok) throw new Error('degraded');
  return r.doc;
}

describe('writeBack — no beautify through edits', () => {
  const src = '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n';
  const flavor = detectFlavor(src, 'markdown');

  it('an empty dirty set returns the source byte-for-byte', () => {
    expect(writeBack(docFor(src), src, new Set(), flavor)).toBe(src);
  });

  it('editing ONE block changes only that block; all else is byte-identical', () => {
    // Replace the text of the SECOND paragraph (block index 2) via a rebuilt doc.
    const doc = docFor(src);
    const target = doc.child(2); // "Second paragraph."
    const edited = liveSchema.node(
      'paragraph',
      target.attrs,
      [liveSchema.text('Second paragraph EDITED.')],
    );
    // Build a fresh doc with the edited block swapped in.
    const blocks: any[] = [];
    doc.forEach((b, _o, i) => blocks.push(i === 2 ? edited : b));
    const swapped = liveSchema.node('doc', null, blocks);
    const out = writeBack(swapped, src, new Set([target.attrs.blockId]), flavor);
    expect(out).toBe('# Title\n\nFirst paragraph.\n\nSecond paragraph EDITED.\n');
  });

  it('serializeDirty returns null for untouched blocks (verbatim)', () => {
    const doc = docFor(src);
    const fn = serializeDirty(new Set(), flavor);
    expect(fn(doc.child(0))).toBeNull();
  });

  it('idempotent: writing back the same edit twice yields the same bytes', () => {
    const doc = docFor(src);
    const blocks: any[] = [];
    doc.forEach((b, _o, i) =>
      blocks.push(i === 2 ? liveSchema.node('paragraph', b.attrs, [liveSchema.text('Edited.')]) : b),
    );
    const swapped = liveSchema.node('doc', null, blocks);
    const dirty = new Set([doc.child(2).attrs.blockId]);
    const once = writeBack(swapped, src, dirty, flavor);
    const twice = writeBack(swapped, src, dirty, flavor);
    expect(once).toBe(twice);
  });

  it('preserves the document flavor when re-serializing an edited block', () => {
    const usrc = 'Text with __strong__ here.\n'; // underscore-strong flavor
    const uflavor = detectFlavor(usrc, 'markdown');
    const doc = docFor(usrc);
    // edit the paragraph: swap in a different bold word
    const edited = liveSchema.node('paragraph', doc.child(0).attrs, [
      liveSchema.text('Text with '),
      liveSchema.text('bold', [liveSchema.marks.strong.create()]),
      liveSchema.text(' here.'),
    ]);
    const swapped = liveSchema.node('doc', null, [edited]);
    const out = writeBack(swapped, usrc, new Set([doc.child(0).attrs.blockId]), uflavor);
    // underscore-strong flavor → serialized strong uses __ not **
    expect(out).toContain('__bold__');
  });
});

describe('writeBack reconciler — structural edits (no beautify)', () => {
  const flavorFor = (s: string) => detectFlavor(s, 'markdown');

  it('no-op: a rich multi-block doc reconstructs byte-for-byte', () => {
    const src =
      '# Title\n\nA paragraph.\n\n- one\n- two\n\n> quote\n\n```js\nx\n```\n\n---\n\nEnd.\n';
    expect(writeBack(docFor(src), src, new Set(), flavorFor(src))).toBe(src);
  });

  it('multi-block edit changes exactly the two edited blocks', () => {
    const src = '# Title\n\nfirst\n\nsecond\n\nthird\n';
    const base = docFor(src);
    const b0 = base.child(0), b1 = base.child(1), b2 = base.child(2), b3 = base.child(3);
    const e1 = liveSchema.node('paragraph', b1.attrs, [liveSchema.text('FIRST')]);
    const e3 = liveSchema.node('paragraph', b3.attrs, [liveSchema.text('THIRD')]);
    const after = liveSchema.node('doc', null, [b0, e1, b2, e3]);
    const dirty = new Set([b1.attrs.blockId as string, b3.attrs.blockId as string]);
    expect(writeBack(after, src, dirty, flavorFor(src))).toBe('# Title\n\nFIRST\n\nsecond\n\nTHIRD\n');
  });

  it('split: one paragraph becomes two; other blocks byte-identical', () => {
    const src = '# Title\n\nonetwo\n\nlast\n';
    const base = docFor(src);
    const b0 = base.child(0), b1 = base.child(1), b2 = base.child(2);
    const paraOne = liveSchema.node('paragraph', b1.attrs, [liveSchema.text('one')]);
    const paraTwo = liveSchema.node('paragraph', { blockId: 'new-0', srcFrom: 0, srcTo: 0 }, [liveSchema.text('two')]);
    const after = liveSchema.node('doc', null, [b0, paraOne, paraTwo, b2]);
    const dirty = new Set([b1.attrs.blockId as string, 'new-0']);
    const out = writeBack(after, src, dirty, flavorFor(src));
    expect(out).toBe('# Title\n\none\n\ntwo\n\nlast\n');
    expect(out.startsWith('# Title\n\n')).toBe(true); // heading byte-identical
    expect(out.endsWith('\n\nlast\n')).toBe(true);    // last block byte-identical
  });

  it('merge: two paragraphs collapse into one; the between-gap vanishes', () => {
    const src = '# Title\n\none\n\ntwo\n\nlast\n';
    const base = docFor(src);
    const b0 = base.child(0), b1 = base.child(1), b3 = base.child(3);
    const merged = liveSchema.node('paragraph', b1.attrs, [liveSchema.text('onetwo')]);
    const after = liveSchema.node('doc', null, [b0, merged, b3]);
    const dirty = new Set([b1.attrs.blockId as string]);
    expect(writeBack(after, src, dirty, flavorFor(src))).toBe('# Title\n\nonetwo\n\nlast\n');
  });

  it('insert HR + trailing empty paragraph at end of doc', () => {
    const src = 'body\n';
    const base = docFor(src);
    const b0 = base.child(0);
    const hr = liveSchema.node('horizontalRule', { blockId: 'new-0', srcFrom: 0, srcTo: 0 });
    const emptyPara = liveSchema.node('paragraph', { blockId: 'new-1', srcFrom: 0, srcTo: 0 });
    const after = liveSchema.node('doc', null, [b0, hr, emptyPara]);
    const dirty = new Set(['new-0', 'new-1']);
    // The trailing empty paragraph is intentional (holds the cursor) and
    // serializes to a trailing blank line — accepted per spec §6.1/§10.
    expect(writeBack(after, src, dirty, flavorFor(src))).toBe('body\n\n---\n\n\n');
  });

  it('delete a middle block; neighbors byte-identical, gap synthesized', () => {
    const src = 'a\n\nb\n\nc\n';
    const base = docFor(src);
    const after = liveSchema.node('doc', null, [base.child(0), base.child(2)]);
    expect(writeBack(after, src, new Set(), flavorFor(src))).toBe('a\n\nc\n');
  });

  it('empty document round-trips to empty', () => {
    expect(writeBack(docFor(''), '', new Set(), flavorFor(''))).toBe('');
  });
});

describe('htmlWriteBack (reconstruction reconciler)', () => {
  const src = '<!doctype html>\n<html>\n<body>\n<p>a</p>\n<p>b</p>\n</body>\n</html>\n';

  it('no-op reconstructs the baseline byte-for-byte', () => {
    const r = toLiveHtml(src);
    if (!r.ok) throw new Error('degraded');
    expect(htmlWriteBack(r.doc, src, new Set(), r.doc)).toBe(src);
  });

  it('inserts a new block with a "\\n" separator; existing blocks byte-identical', () => {
    const r = toLiveHtml(src);
    if (!r.ok) throw new Error('degraded');
    const b0 = r.doc.child(0); // <p>a</p>, id h0
    const b1 = r.doc.child(1); // <p>b</p>, id h1
    const mid = htmlSchema.node(
      'paragraph',
      { htmlAttrs: {}, srcFrom: 0, srcTo: 0, blockId: 'new-0' },
      [htmlSchema.text('mid')],
    );
    const doc = htmlSchema.node('doc', null, [b0, mid, b1]);
    const out = htmlWriteBack(doc, src, new Set(['new-0']), r.doc);
    expect(out).toContain('<p>a</p>\n<p>mid</p>\n<p>b</p>');
    expect(out.startsWith('<!doctype html>\n')).toBe(true);
    expect(out.endsWith('</body>\n</html>\n')).toBe(true);
  });
});
