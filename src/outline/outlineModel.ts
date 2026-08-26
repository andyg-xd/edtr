import { parse } from '../doc/parse';
import type { DocFormat, SourceNode } from '../doc/types';
import type { OutlineEntry } from './types';

/** Concatenate a node's visible text, dropping markup. */
function textOf(node: SourceNode): string {
  if (node.type === 'text') return String(node.data?.text ?? node.raw);
  if (node.children.length === 0) return node.type === 'inlineCode' ? node.raw.replace(/`/g, '') : '';
  return node.children.map(textOf).join('');
}

function isMarkdownHeading(node: SourceNode): boolean {
  return node.type === 'heading' && typeof node.data?.depth === 'number';
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
  const match = isMarkdownHeading;
  const entries: OutlineEntry[] = [];
  for (const block of root.children) {
    const found = headingsWithin(block, match);
    found.forEach((node, i) => {
      entries.push({
        id: node.id,
        level: Number(node.data?.depth ?? 1),
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
