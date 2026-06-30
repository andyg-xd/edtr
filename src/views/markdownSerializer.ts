import type { Node as PMNode, Mark } from 'prosemirror-model';
import type { FlavorProfile } from '../doc/types';

/**
 * Escape characters that could otherwise start markdown inline syntax, so a
 * re-parse of the serialized text yields the same literal content. Conservative
 * (may escape a few characters that wouldn't strictly need it); see PLAN debt.
 */
export function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]~<>]/g, (c) => '\\' + c);
}

const SYMMETRIC = new Set(['strong', 'em', 'strikethrough']);

function symDelim(mark: Mark, flavor: FlavorProfile): string {
  switch (mark.type.name) {
    case 'strong':
      return flavor.strong;
    case 'em':
      return flavor.emphasis;
    case 'strikethrough':
      return '~~';
    default:
      return '';
  }
}

// Stable nesting order so output is deterministic.
const MARK_ORDER = ['strong', 'em', 'strikethrough'];
function orderedSymmetric(marks: readonly Mark[]): Mark[] {
  return marks
    .filter((m) => SYMMETRIC.has(m.type.name))
    .slice()
    .sort((a, b) => MARK_ORDER.indexOf(a.type.name) - MARK_ORDER.indexOf(b.type.name));
}

function serializeImage(node: PMNode): string {
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
  const src = node.attrs.src as string;
  const title = node.attrs.title ? ` "${node.attrs.title}"` : '';
  return `![${alt}](${src}${title})`;
}

// One text node carries one mark set (ProseMirror merges adjacent equal-mark
// runs), so wrapping each text node in its own marks is correct + minimal.
function serializeTextNode(node: PMNode, flavor: FlavorProfile): string {
  const text = node.text ?? '';
  const code = node.marks.find((m) => m.type.name === 'code');
  const link = node.marks.find((m) => m.type.name === 'link');

  let inner = code ? `\`${text}\`` : escapeInline(text);
  for (const m of orderedSymmetric(node.marks)) {
    const d = symDelim(m, flavor);
    inner = `${d}${inner}${d}`;
  }
  if (link) {
    const href = link.attrs.href as string;
    const title = link.attrs.title ? ` "${link.attrs.title}"` : '';
    inner = `[${inner}](${href}${title})`;
  }
  return inner;
}

/** Serialize a textblock's inline content (paragraph/heading) to Markdown. */
export function serializeInline(block: PMNode, flavor: FlavorProfile): string {
  let out = '';
  block.forEach((child) => {
    if (child.type.name === 'image') out += serializeImage(child);
    else if (child.type.name === 'hardBreak') out += '\\\n';
    else if (child.isText) out += serializeTextNode(child, flavor);
  });
  return out;
}
