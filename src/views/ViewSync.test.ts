import { describe, it, expect } from 'vitest';
import { toLive, toSource } from './ViewSync';

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
