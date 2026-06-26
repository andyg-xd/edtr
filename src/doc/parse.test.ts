import { describe, it, expect } from 'vitest';
import { parse } from './parse';
import type { SourceNode } from './types';

function flatten(node: SourceNode, acc: SourceNode[] = []): SourceNode[] {
  acc.push(node);
  for (const c of node.children) flatten(c, acc);
  return acc;
}

describe('parse (markdown)', () => {
  it('assigns byte-accurate ranges so raw === source.slice(range)', () => {
    const src = '# Title\n\nHello **world**.\n';
    const root = parse(src, 'markdown');
    for (const n of flatten(root)) {
      expect(n.raw).toBe(src.slice(n.range[0], n.range[1]));
    }
  });

  it('assigns stable pre-order ids starting at n0', () => {
    const src = '# Title\n\nPara.\n';
    const ids = flatten(parse(src, 'markdown')).map((n) => n.id);
    expect(ids[0]).toBe('n0');
    expect(new Set(ids).size).toBe(ids.length); // unique
  });

  it('captures a heading node with its depth', () => {
    const src = '## Heading\n';
    const heading = flatten(parse(src, 'markdown')).find((n) => n.type === 'heading');
    expect(heading).toBeDefined();
    expect(heading!.data?.depth).toBe(2);
    expect(heading!.raw).toBe('## Heading');
  });
});

describe('parse (html)', () => {
  it('assigns byte-accurate ranges so raw === source.slice(range) for located nodes', () => {
    const src = '<!doctype html>\n<html><body><p>Hello <strong>world</strong></p></body></html>';
    const root = parse(src, 'html');
    for (const n of flatten(root)) {
      // Located nodes must round-trip; skip synthetic nodes that have no source location.
      if (n.range[0] === n.range[1]) continue;
      expect(n.raw).toBe(src.slice(n.range[0], n.range[1]));
    }
  });

  it('captures element nodes by tag name', () => {
    const src = '<p>Hi <strong>there</strong></p>';
    const types = flatten(parse(src, 'html')).map((n) => n.type);
    expect(types).toContain('p');
    expect(types).toContain('strong');
  });
});
