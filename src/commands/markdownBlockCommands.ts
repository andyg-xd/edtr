import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import type { NodeType } from 'prosemirror-model';
import { findWrapping, liftTarget } from 'prosemirror-transform';
import { wrapInList, liftListItem } from 'prosemirror-schema-list';
import { liveSchema } from '../views/liveSchema';

const { paragraph, heading, codeBlock } = liveSchema.nodes;

/** The top-level block containing the cursor's `$from`. */
function topBlock(state: EditorState): { node: import('prosemirror-model').Node; index: number } {
  const { $from } = state.selection;
  const index = $from.index(0);
  return { node: state.doc.child(index), index };
}
function rangeAttrs(node: import('prosemirror-model').Node) {
  return { srcFrom: node.attrs.srcFrom, srcTo: node.attrs.srcTo, blockId: node.attrs.blockId };
}

export function currentBlockType(state: EditorState): string {
  const { node } = topBlock(state);
  switch (node.type.name) {
    case 'heading': return `h${node.attrs.level}`;
    case 'paragraph': return 'paragraph';
    case 'codeBlock': return 'codeBlock';
    case 'blockquote': return 'blockquote';
    case 'orderedList': return 'orderedList';
    case 'bulletList':
      return node.firstChild?.attrs.checked != null ? 'taskList' : 'bulletList';
    default: return 'other';
  }
}
export function blockActive(state: EditorState, kind: string): boolean {
  return currentBlockType(state) === kind;
}
/** False when the cursor's top-level block can't be transformed (verbatim atom, or non-block context). */
export function canTransform(state: EditorState): boolean {
  const { node } = topBlock(state);
  return node.type.name !== 'verbatim';
}

/**
 * Change every top-level textblock touched by the selection to `target` with
 * `extraAttrs` MERGED with each block's own preserved range attrs. setBlockType
 * is position-stable (no size change) and auto-strips marks the target disallows
 * (e.g. codeBlock), so a single pass over the blocks is safe.
 */
function setType(target: NodeType, extraAttrs: Record<string, unknown>): Command {
  return (state, dispatch) => {
    if (!canTransform(state)) return false;
    const { $from, $to } = state.selection;
    const fromIdx = $from.index(0);
    const toIdx = $to.index(0);
    if (dispatch) {
      const tr = state.tr;
      // Recompute block boundaries from the (unchanging-size) doc as we go.
      let pos = 0;
      for (let i = 0; i < fromIdx; i++) pos += state.doc.child(i).nodeSize;
      for (let i = fromIdx; i <= toIdx; i++) {
        const block = state.doc.child(i);
        const inner = pos + 1; // a position inside this block
        tr.setBlockType(inner, inner, target, { ...extraAttrs, ...rangeAttrs(block) });
        pos += block.nodeSize;
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function setHeading(level: number): Command {
  return setType(heading, { level });
}
export const setParagraph: Command = setType(paragraph, {});

export const toggleCodeBlock: Command = (state, dispatch) => {
  if (currentBlockType(state) === 'codeBlock') return setParagraph(state, dispatch);
  return setType(codeBlock, { lang: null })(state, dispatch);
};

// ─── Wrap / unwrap (multi-block grouping) commands ───────────────────────────

const { blockquote, bulletList, orderedList, listItem } = liveSchema.nodes;

/** Dissolve the cursor's top-level blockquote: lift ALL its children back to top level. */
function unwrapBlockquote(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { node: bq, index } = topBlock(state);
  let bqStart = 0;
  for (let i = 0; i < index; i++) bqStart += state.doc.child(i).nodeSize;
  const $start = state.doc.resolve(bqStart + 2);              // inside the first child
  const $end = state.doc.resolve(bqStart + bq.nodeSize - 2);  // inside the last child
  const range = $start.blockRange($end);
  if (!range) return false;
  const target = liftTarget(range);
  if (target == null) return false;
  if (dispatch) dispatch(state.tr.lift(range, target).scrollIntoView());
  return true;
}

/** Dissolve the cursor's top-level list: select across all items, then liftListItem. */
function unwrapList(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { node: list, index } = topBlock(state);
  let start = 0;
  for (let i = 0; i < index; i++) start += state.doc.child(i).nodeSize;
  const $from = state.doc.resolve(start + 1);
  const $to = state.doc.resolve(start + list.nodeSize - 1);
  const expanded = state.apply(state.tr.setSelection(TextSelection.between($from, $to)));
  return liftListItem(listItem)(expanded, dispatch);
}

/** Wrap the selected top-level block(s) in ONE blockquote (all N as children), or dissolve if already a blockquote. */
export const toggleBlockquote: Command = (state, dispatch) => {
  if (!canTransform(state)) return false;
  if (currentBlockType(state) === 'blockquote') return unwrapBlockquote(state, dispatch);
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to);
  if (!range) return false;
  const wrapping = findWrapping(range, blockquote, rangeAttrs(topBlock(state).node));
  if (!wrapping) return false;
  if (dispatch) dispatch(state.tr.wrap(range, wrapping).scrollIntoView());
  return true;
};

/** Wrap the selected top-level block(s) into ONE list with N items, or dissolve if already that list type. */
function toggleListCmd(listType: NodeType, isType: (s: EditorState) => boolean): Command {
  return (state, dispatch) => {
    if (!canTransform(state)) return false;
    if (isType(state)) return unwrapList(state, dispatch);
    return wrapInList(listType, rangeAttrs(topBlock(state).node))(state, dispatch);
  };
}

export const toggleBulletList: Command = toggleListCmd(bulletList, (s) => currentBlockType(s) === 'bulletList');
export const toggleOrderedList: Command = toggleListCmd(orderedList, (s) => currentBlockType(s) === 'orderedList');

/** Task list: wrap into a bullet list whose items are checked:false, or dissolve if already a task list. */
export const toggleTaskList: Command = (state, dispatch) => {
  if (!canTransform(state)) return false;
  if (currentBlockType(state) === 'taskList') return unwrapList(state, dispatch);
  const wrap = wrapInList(bulletList, rangeAttrs(topBlock(state).node));
  if (!dispatch) return wrap(state); // dry-run (isEnabled)
  return wrap(state, (tr) => {
    // The selection now sits inside the new bullet list; mark every item checked:false.
    const $from = tr.selection.$from;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type === bulletList) {
        const listPos = $from.before(d);
        let pos = listPos + 1;
        $from.node(d).forEach((item) => {
          tr.setNodeMarkup(pos, undefined, { ...item.attrs, checked: false });
          pos += item.nodeSize;
        });
        break;
      }
    }
    dispatch(tr.scrollIntoView());
  });
};
