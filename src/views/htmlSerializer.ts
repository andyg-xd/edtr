import type { Node as PMNode, Mark } from 'prosemirror-model';

/** Thrown when a node type has no serializer arm (schema-invariant guard). */
export class HtmlSerializeError extends Error {}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** ` key="value"` per entry, in bag (source) order; double-quoted, escaped. */
function serializeAttrs(bag: Record<string, string> | undefined): string {
  if (!bag) return '';
  let out = '';
  for (const [k, v] of Object.entries(bag)) out += ` ${k}="${escapeAttr(v ?? '')}"`;
  return out;
}

const MARK_TAG: Record<string, string> = {
  strong: 'strong', em: 'em', underline: 'u', strike: 's', code: 'code',
};
// Outermost first: attribute marks (link/span) wrap the styling marks.
const MARK_ORDER = ['link', 'span', 'strong', 'em', 'underline', 'strike', 'code'];

function markTag(m: Mark): string {
  if (m.type.name === 'link') return 'a';
  if (m.type.name === 'span') return 'span';
  const t = MARK_TAG[m.type.name];
  if (!t) throw new HtmlSerializeError(`unknown mark: ${m.type.name}`);
  return t;
}
function openTag(m: Mark): string {
  const tag = markTag(m);
  if (m.type.name === 'link' || m.type.name === 'span') {
    return `<${tag}${serializeAttrs(m.attrs.htmlAttrs as Record<string, string>)}>`;
  }
  return `<${tag}>`;
}
function orderMarks(marks: readonly Mark[]): Mark[] {
  return marks.slice().sort(
    (a, b) => MARK_ORDER.indexOf(a.type.name) - MARK_ORDER.indexOf(b.type.name),
  );
}

function serializeLeaf(node: PMNode): string {
  switch (node.type.name) {
    case 'hardBreak': return '<br>';
    case 'image': return `<img${serializeAttrs(node.attrs.htmlAttrs as Record<string, string>)}>`;
    case 'inlineVerbatim': return node.attrs.raw as string;
    default: throw new HtmlSerializeError(`unknown inline node: ${node.type.name}`);
  }
}

/**
 * Text + marks, coalescing adjacent same-mark runs via an open/close stack.
 * Atoms (image/hardBreak/inlineVerbatim) go through the same open/close-stack
 * logic as text, keyed off their own `marks` — so a marked atom (e.g. an
 * `<img>` wrapped in `<a href>`) keeps its wrapping tag(s) instead of having
 * every mark force-closed before it emits.
 */
function serializeInline(node: PMNode): string {
  let out = '';
  const active: Mark[] = []; // open marks, outermost-first
  const closeFrom = (i: number) => {
    for (let k = active.length - 1; k >= i; k--) out += `</${markTag(active[k])}>`;
    active.length = i;
  };
  node.forEach((child) => {
    const wanted = orderMarks(child.marks);
    let common = 0;
    while (common < active.length && common < wanted.length && active[common].eq(wanted[common])) common++;
    closeFrom(common);
    for (let k = common; k < wanted.length; k++) { out += openTag(wanted[k]); active.push(wanted[k]); }
    out += child.isText ? escapeText(child.text ?? '') : serializeLeaf(child);
  });
  closeFrom(0);
  return out;
}

function serializeChildren(node: PMNode): string {
  let out = '';
  node.forEach((c) => { out += serializeHtmlBlock(c); });
  return out;
}

/** A PM block node → HTML source string. Verbatim atoms emit `raw` untouched. */
export function serializeHtmlBlock(node: PMNode): string {
  const attrs = () => serializeAttrs(node.attrs.htmlAttrs as Record<string, string>);
  switch (node.type.name) {
    case 'paragraph': return `<p${attrs()}>${serializeInline(node)}</p>`;
    case 'heading': { const l = node.attrs.level; return `<h${l}${attrs()}>${serializeInline(node)}</h${l}>`; }
    case 'blockquote': return `<blockquote${attrs()}>${serializeChildren(node)}</blockquote>`;
    case 'div': return `<div${attrs()}>${serializeChildren(node)}</div>`;
    case 'bulletList': return `<ul${attrs()}>${serializeChildren(node)}</ul>`;
    case 'orderedList': return `<ol${attrs()}>${serializeChildren(node)}</ol>`;
    case 'listItem': {
      // A single-paragraph item round-trips as `<li>inline</li>` (common form)
      // ONLY when that paragraph is htmlModel's synthetic zero-attrs wrapper
      // (built for a bare `<li>text</li>`, see htmlModel.ts `listItems`) — a
      // genuine `<li><p class="x">…</p></li>` has attrs on the <p> and MUST
      // keep it wrapped, or those attrs (e.g. `class="x"`) are silently lost.
      const first = node.firstChild;
      const isSyntheticParagraphWrapper =
        node.childCount === 1 &&
        first?.type.name === 'paragraph' &&
        Object.keys((first.attrs.htmlAttrs as Record<string, string> | undefined) ?? {}).length === 0;
      if (isSyntheticParagraphWrapper) {
        return `<li${attrs()}>${serializeInline(first)}</li>`;
      }
      return `<li${attrs()}>${serializeChildren(node)}</li>`;
    }
    case 'codeBlock': return `<pre${attrs()}><code>${escapeText(node.textContent)}</code></pre>`;
    case 'verbatim': return node.attrs.raw as string;
    default: throw new HtmlSerializeError(`unknown block: ${node.type.name}`);
  }
}

/** `toSource` callback: null for a clean block (byte-slice), serialized for a dirty one. */
export function serializeHtmlDirty(dirty: Set<string>): (block: PMNode) => string | null {
  return (block) => {
    const id = block.attrs.blockId as string;
    if (!dirty.has(id)) return null;
    return serializeHtmlBlock(block);
  };
}
