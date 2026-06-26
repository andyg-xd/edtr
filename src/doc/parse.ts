import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { parse as parse5 } from 'parse5';
import type { DocFormat, SourceNode } from './types';

class IdGen {
  private n = 0;
  next(): string {
    return `n${this.n++}`;
  }
}

/** Parse `source` into a position-annotated SourceNode tree. */
export function parse(source: string, format: DocFormat): SourceNode {
  const ids = new IdGen();
  return format === 'markdown'
    ? fromMdast(parseMarkdown(source), source, ids)
    : fromParse5(parseHtml(source), source, ids);
}

// ---- Markdown (remark / mdast) ----

function parseMarkdown(source: string): any {
  return unified().use(remarkParse).use(remarkGfm).parse(source);
}

function fromMdast(node: any, source: string, ids: IdGen): SourceNode {
  const id = ids.next(); // pre-order: id assigned before children
  const start = node.position?.start?.offset ?? 0;
  const end = node.position?.end?.offset ?? 0;
  const data: Record<string, unknown> = {};
  if (typeof node.depth === 'number') data.depth = node.depth;
  return {
    id,
    type: node.type,
    range: [start, end],
    raw: source.slice(start, end),
    children: (node.children ?? []).map((c: any) => fromMdast(c, source, ids)),
    data: Object.keys(data).length ? data : undefined,
  };
}

// ---- HTML (parse5 / default tree adapter) ----

function parseHtml(source: string): any {
  return parse5(source, { sourceCodeLocationInfo: true });
}

function fromParse5(node: any, source: string, ids: IdGen): SourceNode {
  const id = ids.next();
  const loc = node.sourceCodeLocation;
  const start = loc?.startOffset ?? 0;
  const end = loc?.endOffset ?? 0;
  const type: string = node.tagName ?? node.nodeName; // 'p', 'strong', '#text', '#document'
  const data: Record<string, unknown> = {};
  if (node.nodeName === '#text' && typeof node.value === 'string') data.text = node.value;
  return {
    id,
    type,
    range: [start, end],
    raw: start === end ? '' : source.slice(start, end),
    children: (node.childNodes ?? []).map((c: any) => fromParse5(c, source, ids)),
    data: Object.keys(data).length ? data : undefined,
  };
}
