import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SourceDocument } from './document';
import { applyPatches } from './patch';
import type { SourceNode } from './types';

const md = readFileSync(resolve(__dirname, '../../tests/corpus/sample.md'), 'utf8');
const html = readFileSync(resolve(__dirname, '../../tests/corpus/sample.html'), 'utf8');

function flatten(n: SourceNode, acc: SourceNode[] = []): SourceNode[] {
  acc.push(n);
  for (const c of n.children) flatten(c, acc);
  return acc;
}
function paragraphs(doc: SourceDocument): SourceNode[] {
  return flatten(doc.tree).filter((n) => n.type === 'paragraph');
}

describe('applyPatches — no-op guarantee', () => {
  it('returns the markdown source byte-for-byte with no patches', () => {
    const doc = new SourceDocument(md, 'markdown');
    expect(applyPatches(doc, [])).toBe(md);
  });
  it('returns the html source byte-for-byte with no patches', () => {
    const doc = new SourceDocument(html, 'html');
    expect(applyPatches(doc, [])).toBe(html);
  });
});

describe('applyPatches — surgical replace (no beautify)', () => {
  it('replaces one paragraph and leaves every other byte identical', () => {
    const doc = new SourceDocument(md, 'markdown');
    const paras = paragraphs(doc);
    const target = paras[1]; // "This is the second paragraph with _emphasis_."
    const out = applyPatches(doc, [{ kind: 'replace', nodeId: target.id, text: 'REPLACED.' }]);

    // The edit landed.
    expect(out).toContain('REPLACED.');
    expect(out).not.toContain('second paragraph with');
    // Everything before the edited range is identical.
    expect(out.slice(0, target.range[0])).toBe(md.slice(0, target.range[0]));
    // Everything after the edited range is identical (offset by the length delta).
    const delta = 'REPLACED.'.length - (target.range[1] - target.range[0]);
    expect(out.slice(target.range[1] + delta)).toBe(md.slice(target.range[1]));
  });
});

describe('applyPatches — insert and delete', () => {
  it('inserts after a node without touching the node itself', () => {
    const doc = new SourceDocument(md, 'markdown');
    const first = paragraphs(doc)[0];
    const out = applyPatches(doc, [{ kind: 'insertAfter', nodeId: first.id, text: '\n\nINSERTED.' }]);
    expect(out).toContain('INSERTED.');
    expect(out.slice(0, first.range[1])).toBe(md.slice(0, first.range[1])); // node + prefix intact
    expect(out.slice(first.range[1] + '\n\nINSERTED.'.length)).toBe(md.slice(first.range[1])); // suffix shifts right, bytes identical
  });

  it('deletes a node by emptying its range', () => {
    const doc = new SourceDocument(md, 'markdown');
    const second = paragraphs(doc)[1];
    const out = applyPatches(doc, [{ kind: 'delete', nodeId: second.id }]);
    expect(out).not.toContain('second paragraph with');
    expect(out.slice(0, second.range[0])).toBe(md.slice(0, second.range[0]));
    expect(out.slice(second.range[0])).toBe(md.slice(second.range[1])); // suffix shifts left, bytes identical
  });

  it('inserts before a node without touching the node or the bytes before it', () => {
    const doc = new SourceDocument(md, 'markdown');
    const second = paragraphs(doc)[1];
    const text = 'INSERTED.\n\n';
    const out = applyPatches(doc, [{ kind: 'insertBefore', nodeId: second.id, text }]);
    expect(out).toContain('INSERTED.');
    expect(out.slice(0, second.range[0])).toBe(md.slice(0, second.range[0]));       // before insertion point: identical
    expect(out.slice(second.range[0] + text.length)).toBe(md.slice(second.range[0])); // node + suffix shift right, identical
  });

  it('throws on an unknown node id', () => {
    const doc = new SourceDocument(md, 'markdown');
    expect(() => applyPatches(doc, [{ kind: 'replace', nodeId: 'nope', text: 'x' }])).toThrow(/unknown node/i);
  });
});

describe('applyPatches — refuses unlocated nodes', () => {
  it('throws when patching a node with a zero-width (unlocated) range', () => {
    const doc = new SourceDocument(html, 'html');
    // parse5 leaves the synthetic document root unlocated → range [0,0].
    const unlocated = flatten(doc.tree).find((n) => n.range[0] === n.range[1]);
    expect(unlocated).toBeDefined();
    expect(() =>
      applyPatches(doc, [{ kind: 'replace', nodeId: unlocated!.id, text: 'x' }]),
    ).toThrow(/zero-width|reliable source location/i);
  });
});
