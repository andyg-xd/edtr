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

  // Scroll EXPLICITLY. ProseMirror's own scroll starts from the DOM
  // selection's focusNode and silently does nothing when that node sits
  // outside the editor -- which is ALWAYS true here, because the click that
  // brought us in came from the outline panel. Same defect find hit; see
  // pmSurface.ts:186-206.
  const { node } = view.domAtPos(view.state.selection.from, 1);
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  el?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
}

/**
 * The source offset the caret is at, for marking the active outline entry.
 *
 * The inverse of the mapping above, and inexact by the same constraint: a
 * caret inside a `<section>` sits in a node with no source range, so the best
 * available answer is the containing TOP-LEVEL block's `srcFrom`. That is
 * enough to name the section the caret is in, which is all the panel claims —
 * it is not a position and must not be used as one.
 *
 * Null when nothing resolves, so a caller can leave the panel unmarked rather
 * than mark the wrong entry.
 */
export function caretSourceOffsetInPm(view: EditorView): number | null {
  const pos = view.state.selection.from;
  const $pos = view.state.doc.resolve(pos);
  // depth 1 is the top-level block; depth 0 is the doc itself.
  const top = $pos.depth === 0 ? view.state.doc.nodeAt(pos) : $pos.node(1);
  const from = top?.attrs?.srcFrom;
  return typeof from === 'number' && from >= 0 ? from : null;
}
