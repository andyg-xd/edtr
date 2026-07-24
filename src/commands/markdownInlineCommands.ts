import { toggleMark } from 'prosemirror-commands';
import type { Command, EditorState } from 'prosemirror-state';
import type { MarkType, NodeType, ResolvedPos } from 'prosemirror-model';
import { liveSchema } from '../views/liveSchema';

const { strong, em, strikethrough, code, link } = liveSchema.marks;
const { image } = liveSchema.nodes;

/** True if `type` is active at the current selection (stored marks when empty). */
export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

/** True if `nodeType` can be inserted at the current selection. */
export function canInsert(state: EditorState, nodeType: NodeType): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    const index = $from.index(d);
    if ($from.node(d).canReplaceWith(index, index, nodeType)) return true;
  }
  return false;
}

/** Find the [from,to] of the `type` mark covering `$pos`, or null. */
export function getMarkRange(
  $pos: ResolvedPos,
  type: MarkType,
): { from: number; to: number } | null {
  if (!$pos.parent.inlineContent) return null;

  // Primary: the child that starts at or after parentOffset.
  let resolved = $pos.parent.childAfter($pos.parentOffset);

  // Boundary fallback: when the cursor sits exactly at the end of the last
  // inline child, childAfter yields {node:null}. Fall back to childBefore so
  // we still detect the mark that ends exactly here.
  if (!resolved.node && $pos.parentOffset > 0) {
    resolved = $pos.parent.childBefore($pos.parentOffset);
  }

  if (!resolved.node) return null;
  const mark = type.isInSet(resolved.node.marks);
  if (!mark) return null;

  // Derive the resolved child's index and absolute start position so the
  // sibling-walk loops below start from the correct anchor regardless of
  // which branch (childAfter vs childBefore) resolved the node.
  const parentStart = $pos.start();
  let startPos = parentStart + resolved.offset;
  let endPos = startPos + resolved.node.nodeSize;

  // Find the child index by scanning — avoids relying on $pos.index() which
  // returns the child COUNT (not a valid index) at the right boundary.
  let startIndex = 0;
  let scan = 0;
  for (let i = 0; i < $pos.parent.childCount; i++) {
    if (scan === resolved.offset) { startIndex = i; break; }
    scan += $pos.parent.child(i).nodeSize;
  }
  let endIndex = startIndex + 1;

  while (startIndex > 0 && mark.isInSet($pos.parent.child(startIndex - 1).marks)) {
    startIndex -= 1;
    startPos -= $pos.parent.child(startIndex).nodeSize;
  }
  while (endIndex < $pos.parent.childCount && mark.isInSet($pos.parent.child(endIndex).marks)) {
    endPos += $pos.parent.child(endIndex).nodeSize;
    endIndex += 1;
  }
  return { from: startPos, to: endPos };
}

export const toggleStrong: Command = toggleMark(strong);
export const toggleEm: Command = toggleMark(em);
export const toggleStrike: Command = toggleMark(strikethrough);
export const toggleCode: Command = toggleMark(code);

/**
 * Returns true if a link mark can be applied at the current selection.
 * Call WITHOUT `dispatch` for a read-only check; passing `dispatch` would
 * actually apply the toggle and should not be done for a dry-run check.
 */
export const canLink: Command = toggleMark(link);

/**
 * Replace the current selection with `text` carrying a link mark to `href`.
 * If `text` is empty, `href` is used as the visible link text.
 */
export function applyLink(href: string, text: string, title: string | null = null): Command {
  return (state, dispatch) => {
    if (!href) return false;
    const { from, to } = state.selection;
    const content = state.schema.text(text || href, [link.create({ href, title })]);
    if (dispatch) dispatch(state.tr.replaceWith(from, to, content).scrollIntoView());
    return true;
  };
}

/** Remove the link mark across the selection (or the whole link if collapsed). */
export const removeLink: Command = (state, dispatch) => {
  if (!markActive(state, link)) return false;
  if (dispatch) {
    const { from, to, empty, $from } = state.selection;
    let range = { from, to };
    if (empty) {
      const r = getMarkRange($from, link);
      if (r) range = r;
    }
    dispatch(state.tr.removeMark(range.from, range.to, link));
  }
  return true;
};

/** Insert an image inline node at the current selection. */
export function insertImage(
  src: string,
  alt: string | null = null,
  title: string | null = null,
  displaySrc: string | null = null,
): Command {
  return (state, dispatch) => {
    if (!src || !canInsert(state, image)) return false;
    if (dispatch) dispatch(state.tr.replaceSelectionWith(image.create({ src, alt, title, displaySrc })).scrollIntoView());
    return true;
  };
}

/** True if an image node can be inserted at the current selection (Markdown live). */
export function canInsertImage(state: EditorState): boolean {
  return canInsert(state, image);
}
