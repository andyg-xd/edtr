import { parse } from '../doc/parse';
import type { DocFormat, SourceNode } from '../doc/types';
import type { OutlineEntry } from './types';

/**
 * Concatenate a node's visible text, dropping markup.
 *
 * The two parsers name their text nodes differently — mdast says `text`,
 * parse5 says `#text` (`parse.ts:56`, which uses `nodeName` when there is no
 * tag). Both carry the string in `data.text`. Handling only one of them is
 * silent: the structure comes out perfect and every heading is labelled ''.
 */
function textOf(node: SourceNode): string {
  if (node.type === 'text' || node.type === '#text') return String(node.data?.text ?? node.raw);
  if (node.children.length === 0) return node.type === 'inlineCode' ? node.raw.replace(/`/g, '') : '';
  return node.children.map(textOf).join('');
}

function isMarkdownHeading(node: SourceNode): boolean {
  return node.type === 'heading' && typeof node.data?.depth === 'number';
}

const HTML_HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function isHtmlHeading(node: SourceNode): boolean {
  return HTML_HEADINGS.has(node.type);
}

function levelOf(node: SourceNode, format: DocFormat): number {
  return format === 'markdown' ? Number(node.data?.depth ?? 1) : Number(node.type.slice(1));
}

function findFirst(node: SourceNode, type: string): SourceNode | null {
  if (node.type === type) return node;
  for (const child of node.children) {
    const hit = findFirst(child, type);
    if (hit) return hit;
  }
  return null;
}

/**
 * The blocks the outline walks: for HTML that is <body>'s children, which is
 * exactly the set `htmlModel.ts:279` gives source ranges to. Matching that
 * set is what makes `blockFrom`/`blockTo` resolvable in a Live view — and it
 * is also why a heading in <head> never appears: it is not in that set.
 */
function topLevelBlocks(root: SourceNode, format: DocFormat): SourceNode[] {
  if (format === 'markdown') return root.children;
  const body = findFirst(root, 'body');
  return body ? body.children : [];
}

/** Every heading inside `block`, in document order. */
function headingsWithin(block: SourceNode, match: (n: SourceNode) => boolean): SourceNode[] {
  const out: SourceNode[] = [];
  const walk = (n: SourceNode) => {
    if (match(n)) out.push(n);
    n.children.forEach(walk);
  };
  walk(block);
  return out;
}

/**
 * The document's headings, in order, derived from the source (spec D2).
 *
 * Walks TOP-LEVEL blocks and collects the headings within each, so every
 * entry knows both its own range and its block's — the two things a Live
 * view needs to resolve it (spec §4.2).
 */
export function buildOutline(source: string, format: DocFormat): OutlineEntry[] {
  const root = parse(source, format);
  const match = format === 'markdown' ? isMarkdownHeading : isHtmlHeading;
  const entries: OutlineEntry[] = [];
  for (const block of topLevelBlocks(root, format)) {
    const found = headingsWithin(block, match);
    found.forEach((node, i) => {
      entries.push({
        id: node.id,
        level: levelOf(node, format),
        text: textOf(node).trim(),
        srcFrom: node.range[0],
        srcTo: node.range[1],
        ordinalInBlock: i,
        blockFrom: block.range[0],
        blockTo: block.range[1],
      });
    });
  }
  return entries;
}
