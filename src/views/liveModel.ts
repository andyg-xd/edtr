import type { Node as PMNode, Mark } from 'prosemirror-model';
import { liveSchema } from './liveSchema';
import { parseMarkdownAst } from '../doc/parse';

export type LiveResult =
  | { ok: true; doc: PMNode }
  | { ok: false; degrade: true; reason: string };

// Thrown internally when a block can't be safely mapped; caught at the top to degrade.
class DegradeError extends Error {}

interface BuildCtx {
  nextId: () => string;
}

/** Throw to degrade if an mdast node lacks a usable source position. */
function ensureLocated(node: any): { from: number; to: number } {
  const from = node?.position?.start?.offset;
  const to = node?.position?.end?.offset;
  if (typeof from !== 'number' || typeof to !== 'number' || to <= from) {
    throw new DegradeError(`Cannot locate source position for a ${node?.type ?? 'node'} block`);
  }
  return { from, to };
}

/** Top-level blocks carry a real source range + id; nested blocks get schema defaults. */
function rangeAttrs(node: any, ctx: BuildCtx, topLevel: boolean) {
  const { from, to } = ensureLocated(node); // degrade-check applies to every block
  return topLevel ? { srcFrom: from, srcTo: to, blockId: ctx.nextId() } : {};
}

// ---- Inline (Task 4: full mark/node mapping) ----

// Map mdast inline nodes → PM inline nodes, carrying accumulated marks down.
function inlineContent(node: any, source: string): PMNode[] {
  const out: PMNode[] = [];
  for (const child of node.children ?? []) {
    out.push(...inlineNode(child, source, []));
  }
  return out;
}

function inlineNode(node: any, source: string, marks: readonly Mark[]): PMNode[] {
  switch (node.type) {
    case 'text':
      return typeof node.value === 'string' ? [liveSchema.text(node.value, marks)] : [];
    case 'strong':
      return childInline(node, source, addMark(marks, 'strong'));
    case 'emphasis':
      return childInline(node, source, addMark(marks, 'em'));
    case 'delete':
      return childInline(node, source, addMark(marks, 'strikethrough'));
    case 'inlineCode': {
      const value = String(node.value ?? '');
      return value ? [liveSchema.text(value, addMark(marks, 'code'))] : [];
    }
    case 'link':
      return childInline(
        node,
        source,
        marks.concat(liveSchema.marks.link.create({ href: node.url ?? '', title: node.title ?? null })),
      );
    case 'image':
      return [
        liveSchema.node('image', {
          src: node.url ?? '',
          alt: typeof node.alt === 'string' ? node.alt : null,
          title: node.title ?? null,
        }),
      ];
    case 'break':
      return [liveSchema.node('hardBreak')];
    default: {
      // Unknown inline (e.g. inline html, footnoteReference): emit its raw text.
      const from = node?.position?.start?.offset;
      const to = node?.position?.end?.offset;
      const raw =
        typeof node.value === 'string'
          ? node.value
          : typeof from === 'number' && typeof to === 'number'
            ? source.slice(from, to)
            : '';
      return raw ? [liveSchema.text(raw, marks)] : [];
    }
  }
}

function childInline(node: any, source: string, marks: readonly Mark[]): PMNode[] {
  const out: PMNode[] = [];
  for (const child of node.children ?? []) out.push(...inlineNode(child, source, marks));
  return out;
}

function addMark(marks: readonly Mark[], name: 'strong' | 'em' | 'strikethrough' | 'code'): readonly Mark[] {
  return marks.concat(liveSchema.marks[name].create());
}

// ---- Verbatim fallback (filled in Task 5; Task 3 stub uses the raw slice) ----
function buildVerbatim(node: any, source: string, ctx: BuildCtx, topLevel: boolean): PMNode {
  const { from, to } = ensureLocated(node); // single locate: degrade-check + coords
  const r = topLevel ? { srcFrom: from, srcTo: to, blockId: ctx.nextId() } : {};
  return liveSchema.node('verbatim', { raw: source.slice(from, to), ...r });
}

function buildListItem(node: any, source: string, ctx: BuildCtx): PMNode {
  const checked = typeof node.checked === 'boolean' ? node.checked : null;
  const content = (node.children ?? []).map((c: any) => buildBlock(c, source, ctx, false));
  return liveSchema.node('listItem', { checked }, content);
}

function buildBlock(node: any, source: string, ctx: BuildCtx, topLevel: boolean): PMNode {
  switch (node.type) {
    case 'paragraph': {
      const r = rangeAttrs(node, ctx, topLevel);
      return liveSchema.node('paragraph', r, inlineContent(node, source));
    }
    case 'heading': {
      const r = rangeAttrs(node, ctx, topLevel);
      return liveSchema.node('heading', { level: node.depth ?? 1, ...r }, inlineContent(node, source));
    }
    case 'blockquote': {
      const r = rangeAttrs(node, ctx, topLevel);
      const content = (node.children ?? []).map((c: any) => buildBlock(c, source, ctx, false));
      return liveSchema.node('blockquote', r, content);
    }
    case 'code': {
      const r = rangeAttrs(node, ctx, topLevel);
      const value = typeof node.value === 'string' ? node.value : '';
      const text = value.length ? [liveSchema.text(value)] : [];
      return liveSchema.node('codeBlock', { lang: node.lang ?? null, ...r }, text);
    }
    case 'list': {
      const r = rangeAttrs(node, ctx, topLevel);
      const items = (node.children ?? []).map((c: any) => buildListItem(c, source, ctx));
      if (node.ordered) {
        return liveSchema.node('orderedList', { start: node.start ?? 1, ...r }, items);
      }
      return liveSchema.node('bulletList', r, items);
    }
    case 'thematicBreak': {
      const r = rangeAttrs(node, ctx, topLevel);
      return liveSchema.node('horizontalRule', r);
    }
    case 'table': {
      const r = rangeAttrs(node, ctx, topLevel);
      const align = (node.align ?? []) as (string | null)[];
      const rows = (node.children ?? []).map((row: any, rowIdx: number) =>
        liveSchema.node(
          'tableRow',
          null,
          (row.children ?? []).map((cell: any, colIdx: number) =>
            liveSchema.node(
              'tableCell',
              { header: rowIdx === 0, align: align[colIdx] ?? null },
              inlineContent(cell, source),
            ),
          ),
        ),
      );
      return liveSchema.node('table', r, rows);
    }
    default:
      // Unsupported-but-locatable (html, footnoteDefinition, …) → verbatim.
      return buildVerbatim(node, source, ctx, topLevel);
  }
}

/** Pure core: map an mdast root + its source into a Live PM doc, or signal degrade. */
export function mdastToLiveDoc(root: any, source: string): LiveResult {
  let counter = 0;
  const ctx: BuildCtx = { nextId: () => `b${counter++}` };
  try {
    const blocks = (root.children ?? []).map((c: any) => buildBlock(c, source, ctx, true));
    const doc =
      blocks.length > 0
        ? liveSchema.node('doc', null, blocks)
        : liveSchema.node('doc', null, [liveSchema.node('paragraph')]); // empty doc → empty paragraph (no fake range)
    doc.check();
    return { ok: true, doc };
  } catch (e) {
    if (e instanceof DegradeError) return { ok: false, degrade: true, reason: e.message };
    throw e;
  }
}

/** Parse `source` and build the Live PM doc (or signal degrade). */
export function buildLiveDoc(source: string): LiveResult {
  return mdastToLiveDoc(parseMarkdownAst(source), source);
}
