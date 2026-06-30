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
  const title = node.attrs.title != null ? ` "${node.attrs.title}"` : '';
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
    const title = link.attrs.title != null ? ` "${link.attrs.title}"` : '';
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

/** Serialize one block (recursing into blockquote/list content) to Markdown. */
export function serializeBlock(block: PMNode, flavor: FlavorProfile): string {
  switch (block.type.name) {
    case 'verbatim':
      return block.attrs.raw as string;

    case 'paragraph':
      return serializeInline(block, flavor);

    case 'heading': {
      const level = block.attrs.level as number;
      const text = serializeInline(block, flavor);
      if (flavor.headingStyle === 'setext' && (level === 1 || level === 2)) {
        const underline = (level === 1 ? '=' : '-').repeat(Math.max(3, text.length));
        return `${text}\n${underline}`;
      }
      return `${'#'.repeat(level)} ${text}`;
    }

    case 'codeBlock': {
      const fence = flavor.fence.repeat(3);
      const lang = block.attrs.lang ?? '';
      return `${fence}${lang}\n${block.textContent}\n${fence}`;
    }

    case 'horizontalRule':
      return '---';

    case 'blockquote': {
      const inner = serializeBlocks(block, flavor);
      return inner
        .split('\n')
        .map((line) => (line.length ? `> ${line}` : '>'))
        .join('\n');
    }

    case 'bulletList':
      return serializeList(block, flavor, false, 1); // start arg unused for bullets

    case 'orderedList':
      return serializeList(block, flavor, true, block.attrs.start as number);

    default:
      return block.textContent;
  }
}

/** Serialize a sequence of child blocks (blockquote/list-item contents) joined by blank lines. */
function serializeBlocks(parent: PMNode, flavor: FlavorProfile): string {
  const parts: string[] = [];
  parent.forEach((child) => parts.push(serializeBlock(child, flavor)));
  return parts.join('\n\n');
}

function serializeList(list: PMNode, flavor: FlavorProfile, ordered: boolean, start: number): string {
  const lines: string[] = [];
  let n = start;
  list.forEach((item) => {
    const marker = ordered ? `${n++}${flavor.orderedDelimiter}` : flavor.bullet;
    const check = item.attrs.checked === null ? '' : item.attrs.checked ? '[x] ' : '[ ] ';
    // Item body: serialize child blocks; indent continuation lines under the marker.
    const body = serializeBlocks(item, flavor);
    const indent = ' '.repeat(marker.length + 1 + check.length);
    const [first, ...rest] = body.split('\n');
    lines.push(`${marker} ${check}${first}`);
    for (const line of rest) lines.push(line.length ? `${indent}${line}` : '');
  });
  return lines.join('\n');
}
