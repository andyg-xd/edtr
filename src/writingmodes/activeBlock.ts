import type { BlockRange } from './types';

/**
 * Which block the caret sits in.
 *
 * Inclusive at both ends, first match wins. Blocks from either surface never
 * overlap — a CodeMirror line's `to` is the position before the next line's
 * `from`, and a ProseMirror textblock's content range is bounded by its own
 * open and close tokens — so inclusivity cannot make two blocks both claim a
 * position that is genuinely inside one of them.
 *
 * Returns null when the caret is in no block at all, which is a real state
 * rather than an error: an empty document, or a caret resting between two
 * blocks in a Live view. The caller dims everything in that case, which is
 * correct — there is no active block to light.
 *
 * Note for the implementer, so the symmetry is not oversold: this helper is
 * used by the **ProseMirror** focus driver. Code view's engine answers the
 * same question directly with `doc.lineAt(pos)`, so the Code view driver
 * does **not** route through it — forcing it to would be ceremony.
 */
export function activeBlock(blocks: readonly BlockRange[], caret: number): BlockRange | null {
  for (const b of blocks) {
    if (caret >= b.from && caret <= b.to) return b;
  }
  return null;
}
