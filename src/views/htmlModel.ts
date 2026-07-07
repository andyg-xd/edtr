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
// Includes 'table' so a top-level/nested <table> reaches buildBlock's table
// arm (buildTable, or its verbatim fallback) instead of falling through to
// the bare-inline path (which would wrap it as an inlineVerbatim inside a
// synthetic paragraph).
const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'div', 'ul', 'ol', 'li', 'pre', 'table', 'hr',
  'section', 'main', 'article', 'header', 'footer', 'nav', 'aside', 'figure', 'figcaption',
]);

// Semantic containers → the generic `container` node (editable). NOT in this set
// (e.g. <details>, <dl>, custom elements) → read-only verbatim.
const CONTAINER_TAGS = new Set([
  'section', 'main', 'article', 'header', 'footer', 'nav', 'aside', 'figure', 'figcaption',
]);
const isBlockElement = (n: SourceNode) => n.type !== '#text' && BLOCK_TAGS.has(n.type);

// Text + known-inline elements. Semantic containers (section/main/article/etc.)
// in CONTAINER_TAGS are typed nodes. Everything else routes through buildBlock,
// which types known blocks and block-verbatims the rest — unknown top-level
// containers render as a faithful BLOCK verbatim rather than being squashed into a paragraph.
const INLINE_TAGS = new Set([...Object.keys(INLINE_MARK), 'a', 'span', 'img', 'br']);
const isInlineChild = (n: SourceNode) => n.type === '#text' || INLINE_TAGS.has(n.type);

const hasSpan = (cell: SourceNode): boolean => {
  const a = attrsOf(cell);
  return Object.keys(a).some((k) => { const lk = k.toLowerCase(); return lk === 'colspan' || lk === 'rowspan'; });
};

// Rows come from direct <tr> or from <thead>/<tbody> wrappers ONLY. Any other
// child (<tfoot>, <caption>, <colgroup>, <col>, …) → null (→ table verbatim).
function collectTableRows(node: SourceNode): SourceNode[] | null {
  const rows: SourceNode[] = [];
  for (const c of node.children ?? []) {
    if (isWhitespaceText(c)) continue;
    if (c.type === 'tr') { rows.push(c); continue; }
    if (c.type === 'thead' || c.type === 'tbody') {
      for (const gc of c.children ?? []) {
        if (isWhitespaceText(gc)) continue;
        if (gc.type !== 'tr') return null;
        rows.push(gc);
      }
      continue;
    }
    return null;
  }
  return rows.length ? rows : null;
}

type Align = 'left' | 'center' | 'right' | null;

function normalizeAlign(v: string): Align {
  const s = v.trim().toLowerCase();
  return s === 'left' || s === 'center' || s === 'right' ? s : null;
}

/** Pull a cell's authored alignment (align attr or inline text-align) out of its attrs. */
function splitAlign(attrs: Record<string, string>): { align: Align; rest: Record<string, string> } {
  const rest: Record<string, string> = {};
  let align: Align = null;
  for (const [k, v] of Object.entries(attrs)) {
    const lk = k.toLowerCase();
    if (lk === 'align') { align = normalizeAlign(v); continue; } // drop from rest
    if (lk === 'style') {
      const m = /text-align\s*:\s*(left|center|right)/i.exec(v);
      if (m) {
        align = normalizeAlign(m[1]);
        const stripped = v.split(';').map((s) => s.trim()).filter((s) => s && !/^text-align\s*:/i.test(s)).join('; ');
        if (stripped) rest[k] = stripped; // keep other declarations
        continue;
      }
    }
    rest[k] = v;
  }
  return { align, rest };
}

/** A plain, span-free, rectangular <table> → an editable table node; else null (→ verbatim). */
function buildTable(node: SourceNode, range: object, docPath: string | null): PMNode | null {
  const srcRows = collectTableRows(node);
  if (!srcRows) return null;
  const rowCells: SourceNode[][] = [];
  for (const row of srcRows) {
    const cells = (row.children ?? []).filter((c) => !isWhitespaceText(c));
    if (!cells.length || cells.some((c) => c.type !== 'td' && c.type !== 'th')) return null;
    if (cells.some(hasSpan)) return null;
    rowCells.push(cells);
  }
  const width = rowCells[0].length;
  if (rowCells.some((cells) => cells.length !== width)) return null; // ragged
  const rowNodes = srcRows.map((row, r) => {
    const cellNodes = rowCells[r].map((cell) => {
      const content = childBlocks(cell, docPath, false) ?? [htmlSchema.node('paragraph', { htmlAttrs: {} })];
      const { align, rest } = splitAlign(attrsOf(cell));
      return htmlSchema.node('tableCell', { header: cell.type === 'th', align, htmlAttrs: rest }, content);
    });
    return htmlSchema.node('tableRow', { htmlAttrs: attrsOf(row) }, cellNodes);
  });
  return htmlSchema.node('table', { htmlAttrs: attrsOf(node), ...range }, rowNodes);
}

/** Build a block element into a typed node, or a verbatim atom if it doesn't fit. */
function buildBlock(node: SourceNode, range: object, docPath: string | null, allowTable = true): PMNode {
  const verbatim = () => htmlSchema.node('verbatim', { raw: node.raw, ...range });
  const attrs = { htmlAttrs: attrsOf(node), ...range };
  try {
    if (node.type === 'hr') return htmlSchema.node('horizontalRule', { ...range });
    if (node.type === 'p') return htmlSchema.node('paragraph', attrs, buildInline(node, [], docPath));
    if (HEADINGS[node.type])
      return htmlSchema.node('heading', { level: HEADINGS[node.type], ...attrs }, buildInline(node, [], docPath));
    if (node.type === 'pre') return htmlSchema.node('codeBlock', attrs, textOf(node) ? [htmlSchema.text(textOf(node))] : []);
    if (node.type === 'blockquote' || node.type === 'div') {
      const kids = childBlocks(node, docPath, allowTable);
      return kids ? htmlSchema.node(node.type, attrs, kids) : verbatim();
    }
    if (node.type === 'ul' || node.type === 'ol') {
      const items = listItems(node, docPath, allowTable);
      return items ? htmlSchema.node(node.type === 'ul' ? 'bulletList' : 'orderedList', attrs, items) : verbatim();
    }
    if (CONTAINER_TAGS.has(node.type)) {
      const kids = childBlocks(node, docPath, allowTable);
      return kids ? htmlSchema.node('container', { ...attrs, tag: node.type }, kids) : verbatim();
    }
    if (node.type === 'table') return allowTable ? (buildTable(node, range, docPath) ?? verbatim()) : verbatim();
    return verbatim(); // anything else
  } catch {
    return verbatim(); // any content-model rejection → render raw
  }
}

// blockquote/div/container children: block elements pass through; each maximal
// run of loose inline nodes is wrapped in a synthetic zero-attr paragraph.
// Whitespace-only text is pushed into the run (so a space BETWEEN inline
// elements is preserved) but a run that is ENTIRELY whitespace — inter-block
// formatting indentation — is dropped at flush, so no empty paragraphs appear.
// Returns null (→ caller verbatims) only when nothing modelable is found.
function childBlocks(node: SourceNode, docPath: string | null, allowTable = true): PMNode[] | null {
  const out: PMNode[] = [];
  let run: SourceNode[] = [];
  const flush = () => {
    if (!run.length) return;
    const inline = buildInline({ ...node, children: run }, [], docPath);
    run = [];
    const hasContent = inline.some((n) => !n.isText || (n.text ?? '').trim() !== '');
    if (hasContent) out.push(htmlSchema.node('paragraph', { htmlAttrs: {} }, inline));
  };
  for (const c of node.children ?? []) {
    if (isBlockElement(c)) { flush(); out.push(buildBlock(c, {}, docPath, allowTable)); continue; }
    run.push(c); // inline node OR whitespace text; a whitespace-only run is dropped at flush
  }
  flush();
  return out.length ? out : null;
}

function listItems(node: SourceNode, docPath: string | null, allowTable = true): PMNode[] | null {
  const out: PMNode[] = [];
  for (const c of node.children ?? []) {
    if (isWhitespaceText(c)) continue;
    if (c.type !== 'li') return null;
    const kids = childBlocks(c, docPath, allowTable);
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
