import type { Command, EditorState } from 'prosemirror-state';
import type { NodeType } from 'prosemirror-model';
import { findWrapping, liftTarget } from 'prosemirror-transform';
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

// ─── Wrap / unwrap commands ──────────────────────────────────────────────────

const { blockquote, bulletList, orderedList } = liveSchema.nodes;

/** Lift the cursor's block out of its wrapper back to the top level.
 *  We walk down to the first leaf textblock inside the top-level wrapper so
 *  blockRange captures the inner content. This works for both blockquote
 *  (one level: wrapper > paragraph) and lists (two levels: list > listItem > paragraph). */
const unwrap: Command = (state, dispatch) => {
  const { node: wrapperNode, index } = topBlock(state);
  // Compute absolute start position of the top-level wrapper.
  let wrapperStart = 0;
  for (let i = 0; i < index; i++) wrapperStart += state.doc.child(i).nodeSize;
  // Walk down the wrapper's first-child chain to find the first textblock,
  // accumulating the offset from wrapperStart.
  let offset = 1; // skip the wrapper's own open token
  let cur = wrapperNode;
  while (cur.firstChild && !cur.isTextblock) {
    offset += 1; // skip cur's first child's open token
    cur = cur.firstChild;
  }
  // offset now points just inside the first textblock. Resolve that position.
  const innerPos = wrapperStart + offset;
  if (innerPos >= state.doc.content.size) return false;
  const $inner = state.doc.resolve(innerPos);
  const range = $inner.blockRange($inner);
  if (!range) return false;
  const target = liftTarget(range);
  if (target == null) return false;
  if (dispatch) dispatch(state.tr.lift(range, target).scrollIntoView());
  return true;
};

/**
 * Wrap the cursor's single block in `wrapperType` (carrying the block's range attrs),
 * or unwrap if already that type. For task lists, `itemAttrs` are injected into the
 * listItem entry of the wrapping before calling tr.wrap.
 */
function toggleWrap(
  wrapperType: NodeType,
  isType: (state: EditorState) => boolean,
  itemAttrs: Record<string, unknown> = {},
): Command {
  return (state, dispatch) => {
    if (!canTransform(state)) return false;
    if (isType(state)) return unwrap(state, dispatch);
    const { $from, $to } = state.selection;
    const range = $from.blockRange($to);
    if (!range) return false;
    const { node } = topBlock(state);
    const wrapping = findWrapping(range, wrapperType, rangeAttrs(node));
    if (!wrapping) return false;
    if (dispatch) {
      // If itemAttrs are provided (task list), inject them into the listItem entry
      // of the wrapping array so tr.wrap creates the listItem with correct attrs.
      const finalWrapping = Object.keys(itemAttrs).length > 0
        ? wrapping.map((entry) =>
            entry.type === liveSchema.nodes.listItem
              ? { type: entry.type, attrs: { ...entry.attrs, ...itemAttrs } }
              : entry,
          )
        : wrapping;
      const tr = state.tr.wrap(range, finalWrapping);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export const toggleBlockquote: Command = toggleWrap(
  blockquote, (s) => currentBlockType(s) === 'blockquote',
);
export const toggleBulletList: Command = toggleWrap(
  bulletList, (s) => currentBlockType(s) === 'bulletList',
);
export const toggleOrderedList: Command = toggleWrap(
  orderedList, (s) => currentBlockType(s) === 'orderedList',
);
export const toggleTaskList: Command = toggleWrap(
  bulletList, (s) => currentBlockType(s) === 'taskList', { checked: false },
);
