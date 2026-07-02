import { describe, it, expect } from 'vitest';
import { parse, parseMarkdownAst } from './parse';
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

describe('parseMarkdownAst', () => {
  it('returns an mdast root with positioned children and inline values', () => {
    const root = parseMarkdownAst('# Hi\n\nWord\n');
    expect(root.type).toBe('root');
    expect(root.children[0].type).toBe('heading');
    expect(root.children[0].position.start.offset).toBe(0);
    // inline text value is available (lossless, unlike SourceNode.raw)
    expect(root.children[0].children[0].value).toBe('Hi');
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

describe('fromParse5 attribute capture', () => {
  it('captures element attributes into data.attrs', () => {
    const root = parse('<div class="box" id="x" data-k="v">hi</div>', 'html');
    // find the div node anywhere in the tree
    let div: any = null;
    const walk = (n: any) => { if (n.type === 'div') div = n; (n.children ?? []).forEach(walk); };
    walk(root);
    expect(div).toBeTruthy();
    expect(div.data.attrs).toEqual({ class: 'box', id: 'x', 'data-k': 'v' });
  });

  it('omits attrs for an element with none', () => {
    const root = parse('<p>hi</p>', 'html');
    let p: any = null;
    const walk = (n: any) => { if (n.type === 'p') p = n; (n.children ?? []).forEach(walk); };
    walk(root);
    expect(p).toBeTruthy();
    expect(p.data?.attrs).toBeUndefined();
  });
});
