import { describe, it, expect } from 'vitest';
import { toLive, toSource, writeBack, serializeDirty } from './ViewSync';
import { buildLiveDoc } from './liveModel';
import { detectFlavor } from '../doc/flavor';
import { liveSchema } from './liveSchema';

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
    // heading + first paragraph + all whitespace untouched:
    expect(out.startsWith('# Title\n\nFirst paragraph.\n\n')).toBe(true);
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
