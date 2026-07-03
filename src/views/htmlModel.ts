import type { Node as PMNode, Mark } from 'prosemirror-model';
import { parse } from '../doc/parse';
import type { SourceNode } from '../doc/types';
import { htmlSchema } from './htmlSchema';
import { resolveImageDisplaySrc } from '../files/imageAssets';

export type HtmlLiveResult =
  | {
      ok: true;
      doc: PMNode;
      styleText: string;
      bodyAttrs: Record<string, string>;
      rootAttrs: Record<string, string>;
    }
  | { ok: false; degrade: true; reason: string };

class DegradeError extends Error {}

const HEADINGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
const INLINE_MARK: Record<string, string> = {
  strong: 'strong', b: 'strong', em: 'em', i: 'em', u: 'underline',
  s: 'strike', strike: 'strike', del: 'strike', code: 'code',
};

const attrsOf = (n: SourceNode): Record<string, string> =>
  (n.data?.attrs as Record<string, string>) ?? {};
const isWhitespaceText = (n: SourceNode) =>
  n.type === '#text' && typeof n.data?.text === 'string' && (n.data.text as string).trim() === '';

// ---- inline ----
function buildInline(node: SourceNode, marks: readonly Mark[], docPath: string | null): PMNode[] {
  const out: PMNode[] = [];
  for (const child of node.children ?? []) {
    if (child.type === '#text') {
      const t = (child.data?.text as string) ?? '';
      if (t) out.push(htmlSchema.text(t, marks));
      continue;
    }
    if (child.type === 'br') { out.push(htmlSchema.node('hardBreak', undefined, undefined, marks)); continue; }
    if (child.type === 'img') {
      const attrs = attrsOf(child);
      const resolved = resolveImageDisplaySrc(attrs.src ?? '', docPath);
      const displaySrc = resolved === (attrs.src ?? '') ? null : resolved; // only a real local resolution sets it
      out.push(htmlSchema.node('image', { htmlAttrs: attrs, displaySrc }, undefined, marks));
      continue;
    }
    if (INLINE_MARK[child.type]) {
      const mark = htmlSchema.marks[INLINE_MARK[child.type]].create();
      out.push(...buildInline(child, mark.addToSet(marks as Mark[]), docPath));
      continue;
    }
    if (child.type === 'a') {
      const mark = htmlSchema.marks.link.create({ htmlAttrs: attrsOf(child) });
      out.push(...buildInline(child, mark.addToSet(marks as Mark[]), docPath));
      continue;
    }
    if (child.type === 'span') {
      const mark = htmlSchema.marks.span.create({ htmlAttrs: attrsOf(child) });
      out.push(...buildInline(child, mark.addToSet(marks as Mark[]), docPath));
      continue;
    }
    // Unknown inline construct → inline verbatim (renders raw).
    out.push(htmlSchema.node('inlineVerbatim', { raw: child.raw }));
  }
  return out;
}

// ---- block ----
// Includes 'table' so a top-level/nested <table> reaches buildBlock's
// verbatim catch-all instead of falling through to the bare-inline path
// (which would wrap it as an inlineVerbatim inside a synthetic paragraph).
const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'div', 'ul', 'ol', 'li', 'pre', 'table',
]);
const isBlockElement = (n: SourceNode) => n.type !== '#text' && BLOCK_TAGS.has(n.type);

// Text + known-inline elements. Everything else (incl. unknown containers like
// <section>/<main>/<article>) routes through buildBlock, which types known
// blocks and block-verbatims the rest — so unknown top-level containers render
// as a faithful BLOCK verbatim rather than being squashed into a paragraph.
const INLINE_TAGS = new Set([...Object.keys(INLINE_MARK), 'a', 'span', 'img', 'br']);
const isInlineChild = (n: SourceNode) => n.type === '#text' || INLINE_TAGS.has(n.type);

/** Build a block element into a typed node, or a verbatim atom if it doesn't fit. */
function buildBlock(node: SourceNode, range: object, docPath: string | null): PMNode {
  const verbatim = () => htmlSchema.node('verbatim', { raw: node.raw, ...range });
  const attrs = { htmlAttrs: attrsOf(node), ...range };
  try {
    if (node.type === 'p') return htmlSchema.node('paragraph', attrs, buildInline(node, [], docPath));
    if (HEADINGS[node.type])
      return htmlSchema.node('heading', { level: HEADINGS[node.type], ...attrs }, buildInline(node, [], docPath));
    if (node.type === 'pre') return htmlSchema.node('codeBlock', attrs, textOf(node) ? [htmlSchema.text(textOf(node))] : []);
    if (node.type === 'blockquote' || node.type === 'div') {
      const kids = childBlocks(node, docPath);
      return kids ? htmlSchema.node(node.type, attrs, kids) : verbatim();
    }
    if (node.type === 'ul' || node.type === 'ol') {
      const items = listItems(node, docPath);
      return items ? htmlSchema.node(node.type === 'ul' ? 'bulletList' : 'orderedList', attrs, items) : verbatim();
    }
    return verbatim(); // table + anything else
  } catch {
    return verbatim(); // any content-model rejection → render raw
  }
}

// blockquote/div children must all be block elements (whitespace-only text ignored); else null → caller verbatims.
function childBlocks(node: SourceNode, docPath: string | null): PMNode[] | null {
  const out: PMNode[] = [];
  for (const c of node.children ?? []) {
    if (isWhitespaceText(c)) continue;
    if (!isBlockElement(c)) return null;
    out.push(buildBlock(c, {}, docPath));
  }
  return out.length ? out : null;
}

function listItems(node: SourceNode, docPath: string | null): PMNode[] | null {
  const out: PMNode[] = [];
  for (const c of node.children ?? []) {
    if (isWhitespaceText(c)) continue;
    if (c.type !== 'li') return null;
    const kids = childBlocks(c, docPath);
    // A li with inline content (no block children) → wrap its inline in a paragraph.
    const content = kids ?? [htmlSchema.node('paragraph', { htmlAttrs: {} }, buildInline(c, [], docPath))];
    out.push(htmlSchema.node('listItem', { htmlAttrs: attrsOf(c) }, content));
  }
  return out.length ? out : null;
}

function textOf(node: SourceNode): string {
  let s = '';
  const walk = (n: SourceNode) => {
    if (n.type === '#text') s += (n.data?.text as string) ?? '';
    (n.children ?? []).forEach(walk);
  };
  walk(node);
  return s;
}

// ---- tree helpers ----
function findFirst(root: SourceNode, type: string): SourceNode | null {
  if (root.type === type) return root;
  for (const c of root.children ?? []) {
    const hit = findFirst(c, type);
    if (hit) return hit;
  }
  return null;
}
function collectStyles(root: SourceNode): string {
  let css = '';
  const walk = (n: SourceNode) => {
    if (n.type === 'style') css += textOf(n) + '\n';
    (n.children ?? []).forEach(walk);
  };
  walk(root);
  return css;
}

export function toLiveHtml(source: string, docPath: string | null = null): HtmlLiveResult {
  try {
    const root = parse(source, 'html');
    const body = findFirst(root, 'body');
    if (!body) throw new DegradeError('no <body> element');
    const bodyAttrs = attrsOf(body);
    const htmlEl = findFirst(root, 'html');
    const rootAttrs = htmlEl ? attrsOf(htmlEl) : {};
    const styleText = collectStyles(root);
    let counter = 0;
    const blocks: PMNode[] = [];
    for (const child of body.children ?? []) {
      if (isWhitespaceText(child)) continue;
      // doc/parse.ts populates a real range for every node (incl. #text), so
      // always carry it — a 0/0 range would break 4b's byte-slice reconciler.
      const range = { srcFrom: child.range[0], srcTo: child.range[1], blockId: `h${counter++}` };
      // Text + known-inline → wrap in a paragraph; everything else (known
      // blocks + unknown containers) → buildBlock (types or block-verbatims it).
      const node = isInlineChild(child)
        ? htmlSchema.node('paragraph', { htmlAttrs: {}, ...range }, buildInline({ ...body, children: [child] }, [], docPath))
        : buildBlock(child, range, docPath);
      blocks.push(node);
    }
    const doc = blocks.length
      ? htmlSchema.node('doc', null, blocks)
      : htmlSchema.node('doc', null, [htmlSchema.node('paragraph', { htmlAttrs: {} })]);
    doc.check();
    return { ok: true, doc, styleText, bodyAttrs, rootAttrs };
  } catch (e) {
    if (e instanceof DegradeError) return { ok: false, degrade: true, reason: e.message };
    return { ok: false, degrade: true, reason: String(e) };
  }
}
