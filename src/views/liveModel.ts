import type { Node as PMNode } from 'prosemirror-model';
import { liveSchema } from './liveSchema';
import { parseMarkdownAst } from '../doc/parse';

export type LiveResult =
  | { ok: true; doc: PMNode }
  | { ok: false; degrade: true; reason: string };

// Thrown internally when a block can't be safely mapped; caught at the top to degrade.
class DegradeError extends Error {}

let blockCounter = 0;
function nextBlockId(): string {
  return `b${blockCounter++}`;
}

/** [from, to) source range of an mdast node, or throw to force degradation. */
function blockRange(node: any): { srcFrom: number; srcTo: number; blockId: string } {
  const from = node?.position?.start?.offset;
  const to = node?.position?.end?.offset;
  if (typeof from !== 'number' || typeof to !== 'number' || to <= from) {
    throw new DegradeError(`Cannot locate source position for a ${node?.type ?? 'node'} block`);
  }
  return { srcFrom: from, srcTo: to, blockId: nextBlockId() };
}

// ---- Inline (filled in Task 4; Task 3 stub renders plain text) ----
function inlineContent(node: any, _source: string): PMNode[] {
  const out: PMNode[] = [];
  for (const child of node.children ?? []) {
    if (child.type === 'text' && typeof child.value === 'string') {
      out.push(liveSchema.text(child.value));
    }
  }
  return out;
}

// ---- Verbatim fallback (filled in Task 5; Task 3 stub uses the raw slice) ----
function buildVerbatim(node: any, source: string): PMNode {
  const { srcFrom, srcTo, blockId } = blockRange(node);
  return liveSchema.node('verbatim', { raw: source.slice(srcFrom, srcTo), srcFrom, srcTo, blockId });
}

function buildListItem(node: any, source: string): PMNode {
  const checked = typeof node.checked === 'boolean' ? node.checked : null;
  const content = (node.children ?? []).map((c: any) => buildBlock(c, source));
  return liveSchema.node('listItem', { checked }, content);
}

function buildBlock(node: any, source: string): PMNode {
  switch (node.type) {
    case 'paragraph': {
      const r = blockRange(node);
      return liveSchema.node('paragraph', r, inlineContent(node, source));
    }
    case 'heading': {
      const r = blockRange(node);
      return liveSchema.node('heading', { level: node.depth ?? 1, ...r }, inlineContent(node, source));
    }
    case 'blockquote': {
      const r = blockRange(node);
      const content = (node.children ?? []).map((c: any) => buildBlock(c, source));
      return liveSchema.node('blockquote', r, content);
    }
    case 'code': {
      const r = blockRange(node);
      const value = typeof node.value === 'string' ? node.value : '';
      const text = value.length ? [liveSchema.text(value)] : [];
      return liveSchema.node('codeBlock', { lang: node.lang ?? null, ...r }, text);
    }
    case 'list': {
      const r = blockRange(node);
      const items = (node.children ?? []).map((c: any) => buildListItem(c, source));
      if (node.ordered) {
        return liveSchema.node('orderedList', { start: node.start ?? 1, ...r }, items);
      }
      return liveSchema.node('bulletList', r, items);
    }
    case 'thematicBreak': {
      const r = blockRange(node);
      return liveSchema.node('horizontalRule', r);
    }
    default:
      // Unsupported-but-locatable (table, html, footnoteDefinition, …) → verbatim.
      return buildVerbatim(node, source);
  }
}

/** Pure core: map an mdast root + its source into a Live PM doc, or signal degrade. */
export function mdastToLiveDoc(root: any, source: string): LiveResult {
  blockCounter = 0;
  try {
    const blocks = (root.children ?? []).map((c: any) => buildBlock(c, source));
    const doc =
      blocks.length > 0
        ? liveSchema.node('doc', null, blocks)
        : liveSchema.node('doc', null, [liveSchema.node('paragraph', blockRangeForEmpty())]);
    doc.check();
    return { ok: true, doc };
  } catch (e) {
    if (e instanceof DegradeError) return { ok: false, degrade: true, reason: e.message };
    throw e;
  }
}

// An empty document still needs one valid (empty) paragraph for the schema.
function blockRangeForEmpty() {
  return { srcFrom: 0, srcTo: 0, blockId: nextBlockId() };
}

/** Parse `source` and build the Live PM doc (or signal degrade). */
export function buildLiveDoc(source: string): LiveResult {
  return mdastToLiveDoc(parseMarkdownAst(source), source);
}
