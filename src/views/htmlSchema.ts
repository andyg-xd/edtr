import { Schema, type NodeSpec, type MarkSpec } from 'prosemirror-model';
import { safeAttrs, sanitizeHtml } from './htmlSanitize';

// Source-range attrs carried by every block node.
const rangeAttrs = {
  srcFrom: { default: 0 },
  srcTo: { default: 0 },
  blockId: { default: '' },
};

// Generic HTML-attribute bag (class/id/style/data-*/etc.). Default {} is never
// mutated (toDOM only reads it), so sharing the default reference is safe.
const attrBag = { htmlAttrs: { default: {} as Record<string, string> } };

/**
 * DOM output helper: [tag, htmlAttrs, hole?] with hole for content nodes.
 * Sanitized at render time (drops on* handlers / javascript: URLs) — the
 * node's own `htmlAttrs` stays verbatim; only what's emitted to toDOM is
 * cleaned, so write-back later still sees the untouched source attrs.
 */
const domAttrs = (n: { attrs: { htmlAttrs?: Record<string, string> } }) =>
  safeAttrs((n.attrs.htmlAttrs ?? {}) as Record<string, string>);

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  paragraph: {
    group: 'block',
    content: 'inline*',
    attrs: { ...attrBag, ...rangeAttrs },
    toDOM: (n) => ['p', domAttrs(n), 0],
  },

  heading: {
    group: 'block',
    content: 'inline*',
    attrs: { level: { default: 1 }, ...attrBag, ...rangeAttrs },
    toDOM: (n) => [`h${n.attrs.level}`, domAttrs(n), 0],
  },

  blockquote: {
    group: 'block',
    content: 'block+',
    attrs: { ...attrBag, ...rangeAttrs },
    toDOM: (n) => ['blockquote', domAttrs(n), 0],
  },

  div: {
    group: 'block',
    content: 'block+',
    attrs: { ...attrBag, ...rangeAttrs },
    toDOM: (n) => ['div', domAttrs(n), 0],
  },

  container: {
    group: 'block',
    content: 'block+',
    attrs: { tag: { default: 'div' }, ...attrBag, ...rangeAttrs },
    toDOM: (n) => [n.attrs.tag as string, domAttrs(n), 0],
  },

  bulletList: {
    group: 'block',
    content: 'listItem+',
    attrs: { ...attrBag, ...rangeAttrs },
    toDOM: (n) => ['ul', domAttrs(n), 0],
  },

  orderedList: {
    group: 'block',
    content: 'listItem+',
    attrs: { ...attrBag, ...rangeAttrs },
    toDOM: (n) => ['ol', domAttrs(n), 0],
  },

  listItem: {
    content: 'block+',
    attrs: { ...attrBag, ...rangeAttrs },
    toDOM: (n) => ['li', domAttrs(n), 0],
  },

  codeBlock: {
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    attrs: { ...attrBag, ...rangeAttrs },
    toDOM: (n) => ['pre', domAttrs(n), ['code', 0]],
  },

  horizontalRule: {
    group: 'block',
    attrs: { ...rangeAttrs },
    toDOM: () => ['hr'],
  },

  // Block escape hatch: renders exact raw HTML (read-only). For tables/unknown/
  // content-model mismatches. `parseDOM`-free; render via a template fragment.
  verbatim: {
    group: 'block',
    atom: true,
    attrs: { raw: { default: '' }, ...rangeAttrs },
    toDOM: (n) => {
      const tpl = document.createElement('template');
      tpl.innerHTML = sanitizeHtml(n.attrs.raw as string);
      const wrap = document.createElement('div');
      wrap.setAttribute('data-verbatim', '');
      wrap.appendChild(tpl.content.cloneNode(true));
      return wrap;
    },
  },

  text: { group: 'inline' },

  image: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { ...attrBag, displaySrc: { default: null } },
    toDOM: (n) => {
      const a = domAttrs(n); // safeAttrs(htmlAttrs) — the source `src` stays verbatim
      if (n.attrs.displaySrc) a.src = n.attrs.displaySrc as string; // render via asset protocol
      return ['img', a];
    },
  },

  hardBreak: {
    group: 'inline',
    inline: true,
    atom: true,
    toDOM: () => ['br'],
  },

  inlineVerbatim: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { raw: { default: '' } },
    toDOM: (n) => {
      const span = document.createElement('span');
      span.setAttribute('data-verbatim', '');
      const tpl = document.createElement('template');
      tpl.innerHTML = sanitizeHtml(n.attrs.raw as string);
      span.appendChild(tpl.content.cloneNode(true));
      return span;
    },
  },
};

const marks: Record<string, MarkSpec> = {
  strong: { toDOM: () => ['strong', 0] },
  em: { toDOM: () => ['em', 0] },
  underline: { toDOM: () => ['u', 0] },
  strike: { toDOM: () => ['s', 0] },
  code: { toDOM: () => ['code', 0] },
  link: {
    attrs: { ...attrBag },
    inclusive: false,
    toDOM: (m) => ['a', safeAttrs((m.attrs.htmlAttrs ?? {}) as Record<string, string>), 0],
  },
  span: {
    attrs: { ...attrBag },
    toDOM: (m) => ['span', safeAttrs((m.attrs.htmlAttrs ?? {}) as Record<string, string>), 0],
  },
};

export const htmlSchema = new Schema({ nodes, marks });
