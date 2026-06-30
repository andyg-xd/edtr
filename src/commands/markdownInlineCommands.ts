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
  const start = $pos.parent.childAfter($pos.parentOffset);
  if (!start.node) return null;
  const mark = type.isInSet(start.node.marks);
  if (!mark) return null;
  let startIndex = $pos.index();
  let startPos = $pos.start() + start.offset;
  let endIndex = startIndex + 1;
  let endPos = startPos + start.node.nodeSize;
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

/** Dry-run proxy for "a link mark can be applied at this selection". */
export const canLink: Command = toggleMark(link);

/** Replace the current selection with `text` carrying a link mark to `href`. */
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
export function insertImage(src: string, alt: string | null = null, title: string | null = null): Command {
  return (state, dispatch) => {
    if (!src || !canInsert(state, image)) return false;
    if (dispatch) dispatch(state.tr.replaceSelectionWith(image.create({ src, alt, title })).scrollIntoView());
    return true;
  };
}
