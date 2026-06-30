import { Schema, type NodeSpec, type MarkSpec } from 'prosemirror-model';

// Source-range attrs carried by every top-level block (direct child of doc).
// Nested uses (e.g. a paragraph inside a list item) leave them at defaults.
const rangeAttrs = {
  srcFrom: { default: 0 },
  srcTo: { default: 0 },
  blockId: { default: '' },
};

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  paragraph: {
    group: 'block',
    content: 'inline*',
    attrs: { ...rangeAttrs },
    toDOM: () => ['p', 0],
  },

  heading: {
    group: 'block',
    content: 'inline*',
    attrs: { level: { default: 1 }, ...rangeAttrs },
    toDOM: (node) => [`h${node.attrs.level}`, 0],
  },

  blockquote: {
    group: 'block',
    content: 'block+',
    attrs: { ...rangeAttrs },
    toDOM: () => ['blockquote', 0],
  },

  codeBlock: {
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    attrs: { lang: { default: null }, ...rangeAttrs },
    toDOM: (node) => [
      'pre',
      node.attrs.lang ? { 'data-lang': node.attrs.lang } : {},
      ['code', 0],
    ],
  },

  bulletList: {
    group: 'block',
    content: 'listItem+',
    attrs: { ...rangeAttrs },
    toDOM: () => ['ul', 0],
  },

  orderedList: {
    group: 'block',
    content: 'listItem+',
    attrs: { start: { default: 1 }, ...rangeAttrs },
    toDOM: (node) => ['ol', node.attrs.start !== 1 ? { start: node.attrs.start } : {}, 0],
  },

  // List items are NOT top-level blocks; no source range. `checked` is null
  // for a normal item, true/false for a GFM task item.
  listItem: {
    content: 'block+',
    defining: true,
    attrs: { checked: { default: null } },
    toDOM: (node) => {
      if (node.attrs.checked === null) return ['li', 0];
      const box: Record<string, unknown> = { type: 'checkbox', disabled: true };
      if (node.attrs.checked) box.checked = true;
      return ['li', { class: 'task-item' }, ['input', box], ['div', { class: 'task-body' }, 0]];
    },
  },

  horizontalRule: {
    group: 'block',
    attrs: { ...rangeAttrs },
    toDOM: () => ['hr'],
  },

  // Unsupported-but-locatable construct, shown read-only as its raw markdown.
  verbatim: {
    group: 'block',
    atom: true,
    attrs: { raw: { default: '' }, ...rangeAttrs },
    toDOM: (node) => ['pre', { class: 'md-verbatim' }, node.attrs.raw as string],
  },

  image: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { src: { default: '' }, alt: { default: null }, title: { default: null } },
    toDOM: (node) => {
      const attrs: Record<string, unknown> = { src: node.attrs.src };
      if (node.attrs.alt !== null) attrs.alt = node.attrs.alt;
      if (node.attrs.title !== null) attrs.title = node.attrs.title;
      return ['img', attrs];
    },
  },

  hardBreak: {
    group: 'inline',
    inline: true,
    selectable: false,
    toDOM: () => ['br'],
  },

  text: { group: 'inline' },
};

const marks: Record<string, MarkSpec> = {
  strong: { toDOM: () => ['strong', 0] },
  em: { toDOM: () => ['em', 0] },
  strikethrough: { toDOM: () => ['s', 0] },
  code: { toDOM: () => ['code', 0] },
  link: {
    attrs: { href: { default: '' }, title: { default: null } },
    inclusive: false,
    toDOM: (mark) => {
      const attrs: Record<string, unknown> = { href: mark.attrs.href };
      if (mark.attrs.title !== null) attrs.title = mark.attrs.title;
      return ['a', attrs, 0];
    },
  },
};

export const liveSchema = new Schema({ nodes, marks });
