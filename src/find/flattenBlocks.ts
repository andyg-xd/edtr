import type { Node as PMNode } from 'prosemirror-model';
import type { OffsetRun, Segment } from './types';

/**
 * Atoms that contribute NO searchable text.
 *
 * HTML Live's verbatim regions (`<script>`, `<style>`, unknown tags) are atoms
 * with no inner positions to decorate, so they can never match — Code view
 * stays the way to search them (design §5.3). As a side effect, 6c-i-b needs
 * no "refuse replace inside verbatim" rule: find can never target one.
 */
const SKIP_ATOMS = new Set(['image', 'verbatim', 'inlineVerbatim']);

/**
 * One segment per TOP-LEVEL block: its visible text plus the map from flat
 * offsets back to document positions.
 *
 * Segments rather than one concatenated string (design §5.2): a joined string
 * needs a separator, and a match could then span it — silently breaking "a
 * match never crosses a block". Segmenting makes that guarantee structural
 * instead of enforced by a check, and it lets the matcher stay a plain
 * function over one string.
 *
 * `hardBreak` contributes a newline, because a hard break is a line the user
 * can see and `$` should land at it. Every other atom contributes nothing.
 */
export function flattenBlocks(doc: PMNode): Segment[] {
  const segments: Segment[] = [];
  doc.forEach((block, offset) => {
    const runs: OffsetRun[] = [];
    let text = '';
    // `descendants` reports positions relative to the block's CONTENT, so the
    // absolute position is (position before the block) + 1 (its opening token)
    // + the reported offset.
    const base = offset + 1;
    block.descendants((node, pos) => {
      if (node.isText) {
        const value = node.text ?? '';
        runs.push({ from: text.length, len: value.length, pos: base + pos });
        text += value;
        return false;
      }
      if (node.type.name === 'hardBreak') {
        runs.push({ from: text.length, len: 1, pos: base + pos });
        text += '\n';
        return false;
      }
      if (SKIP_ATOMS.has(node.type.name)) return false;
      return true; // a container — keep descending
    });
    segments.push({ text, map: { runs } });
  });
  return segments;
}
