import type { Node as PMNode } from 'prosemirror-model';
import type { OffsetRun, Segment } from './types';

/**
 * Atoms that contribute NO searchable text.
 *
 * HTML Live's verbatim regions (`<script>`, `<style>`, unknown tags) are atoms
 * with no inner positions to decorate, so they can never match — Code view
 * stays the way to search them (design §5.3). As a side effect, 6c-i-b needs
 * no "refuse replace inside verbatim" rule: find can never target one.
 *
 * Exported for `pmSurface`'s replace path (D6, spec §K5): these are exactly
 * the nodes a match can span WITHOUT the user seeing them in the matched
 * text — `hardBreak` is also an atom in the HTML schema but contributes a
 * visible `\n` below and is deliberately not in this set. An edit that spans
 * one of these removes something invisible to the text the user searched, so
 * it must be counted and disclosed rather than silently taken.
 */
export const SKIP_ATOMS = new Set(['image', 'verbatim', 'inlineVerbatim']);

/**
 * One segment per VISIBLE BLOCK (`node.isTextblock` — paragraph, heading,
 * codeBlock, a Markdown-schema tableCell, ...): its visible text plus the map
 * from flat offsets back to document positions.
 *
 * Segments rather than one concatenated string, and one per TEXTBLOCK rather
 * than one per top-level node (design §5.2): a container (`bulletList`,
 * `blockquote`, `table`, an HTML `<section>`/`<div>`, an HTML tableCell whose
 * content is `block+`, ...) can hold several visible blocks, and joining
 * their text with no separator would let a match span two paragraphs the user
 * sees as separate — silently breaking "a match never crosses a block". Every
 * textblock gets its own segment regardless of nesting depth, so that
 * guarantee is structural rather than aspirational: a container's children
 * are always separate segments, all the way down.
 *
 * `hardBreak` contributes a newline. `$` does NOT anchor there (`multiline` is
 * off for this surface — see pmSurface.ts) — the newline matters instead
 * because without it the visible text either side of the break would run
 * together into one word, breaking whole-word matching across it.
 */
export function flattenBlocks(doc: PMNode): Segment[] {
  const segments: Segment[] = [];
  doc.descendants((node, pos) => {
    if (SKIP_ATOMS.has(node.type.name)) return false; // no searchable text
    if (!node.isTextblock) return true; // a container — keep descending
    const runs: OffsetRun[] = [];
    let text = '';
    // `descendants` reports positions relative to the block's CONTENT, so the
    // absolute position is (position before the block) + 1 (its opening token)
    // + the reported offset.
    const base = pos + 1;
    node.descendants((child, childPos) => {
      if (child.isText) {
        const value = child.text ?? '';
        runs.push({ from: text.length, len: value.length, pos: base + childPos });
        text += value;
        return false;
      }
      if (child.type.name === 'hardBreak') {
        runs.push({ from: text.length, len: 1, pos: base + childPos });
        text += '\n';
        return false;
      }
      if (SKIP_ATOMS.has(child.type.name)) return false;
      return true; // a container — keep descending
    });
    segments.push({ text, map: { runs } });
    return false; // a textblock's children are inline; the inner walk covered them
  });
  return segments;
}
