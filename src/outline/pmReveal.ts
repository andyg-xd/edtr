import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { OutlineEntry } from './types';

/** Position of the top-level block whose source range contains `offset`, or null. */
function topLevelBlockAt(doc: PMNode, offset: number): { node: PMNode; pos: number } | null {
  let hit: { node: PMNode; pos: number } | null = null;
  doc.forEach((node, pos) => {
    if (hit) return;
    const from = node.attrs?.srcFrom;
    const to = node.attrs?.srcTo;
    if (typeof from !== 'number' || typeof to !== 'number' || to <= from) return;
    if (offset >= from && offset < to) hit = { node, pos };
  });
  return hit;
}

/**
 * Jump to `entry` in a Live view.
 *
 * Nested blocks carry NO source range in either live model (spec §4.2), so a
 * heading inside a <section> cannot be found by its own offset. Resolution is
 * two-step: the containing top-level block by range, then the nth heading
 * inside it by ordinal — both computed from the same source parse.
 */
export function revealSourceInPm(view: EditorView, entry: OutlineEntry): void {
  // A live-derived entry (`buildLiveOutline`) knows exactly where its heading
  // is, because it was walked out of this very document — no block range, no
  // ordinal, no inexactness. Its source fields are ZERO, so the two-step path
  // below cannot resolve it at all: it would look for the block containing
  // offset 0 and land on the first block every time. Checked first for that
  // reason, not merely as an optimisation.
  //
  // Bounds-checked because a position from an earlier document version can
  // outlive its document, and `resolve` throws past the end — the exact
  // mechanism that blanked the window twice in 6c-i-a.
  if (entry.pmPos !== undefined) {
    if (entry.pmPos < 0 || entry.pmPos > view.state.doc.content.size) return;
    const $exact = view.state.doc.resolve(
      Math.min(entry.pmPos + 1, view.state.doc.content.size),
    );
    view.dispatch(view.state.tr.setSelection(TextSelection.near($exact)));
    scrollSelectionIntoView(view);
    return;
  }

  const block = topLevelBlockAt(view.state.doc, entry.blockFrom);
  if (!block) return; // nothing to reveal; never throw out of a React effect

  // Inside the block, the nth heading. `descendants` walks in document order.
  let seen = 0;
  let target: number | null = null;
  block.node.descendants((node, pos) => {
    if (target !== null) return false;
    if (node.type.name !== 'heading') return true;
    if (seen === entry.ordinalInBlock) target = block.pos + 1 + pos;
    seen++;
    return false;
  });

  // The block itself IS the heading (Markdown's usual shape).
  if (target === null && block.node.type.name === 'heading') target = block.pos;
  // Spec D10: a near-miss reveals the containing block rather than nothing.
  const pos = target ?? block.pos;

  const $pos = view.state.doc.resolve(Math.min(pos + 1, view.state.doc.content.size));
  view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
  scrollSelectionIntoView(view);
}

/**
 * Scroll EXPLICITLY. ProseMirror's own scroll starts from the DOM selection's
 * focusNode and silently does nothing when that node sits outside the editor —
 * which is ALWAYS true here, because the click that brought us in came from the
 * outline panel. Same defect find hit; see pmSurface.ts:186-206.
 *
 * Shared by both resolution paths so they cannot drift into two different
 * ideas of what "reveal" means.
 */
function scrollSelectionIntoView(view: EditorView): void {
  const { node } = view.domAtPos(view.state.selection.from, 1);
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  el?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
}
