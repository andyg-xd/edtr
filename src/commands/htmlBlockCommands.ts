import { type Command, type EditorState, type Transaction, TextSelection } from 'prosemirror-state';
import type { NodeType, Node as PMNode } from 'prosemirror-model';
import { findWrapping, liftTarget } from 'prosemirror-transform';
import { wrapInList, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { htmlSchema } from '../views/htmlSchema';

const { paragraph, heading, codeBlock, blockquote, bulletList, orderedList, listItem } = htmlSchema.nodes;

function topBlock(state: EditorState): PMNode {
  const { $from } = state.selection;
  return state.doc.child($from.index(0));
}
function rangeAttrs(node: PMNode) {
  return { srcFrom: node.attrs.srcFrom, srcTo: node.attrs.srcTo, blockId: node.attrs.blockId };
}

/** Type of the cursor's top-level block: 'h{n}' | 'paragraph' | 'codeBlock' | 'blockquote' | 'bulletList' | 'orderedList' | 'other'. */
export function currentBlockType(state: EditorState): string {
  const node = topBlock(state);
  switch (node.type.name) {
    case 'heading': return `h${node.attrs.level as number}`;
    case 'paragraph': return 'paragraph';
    case 'codeBlock': return 'codeBlock';
    case 'blockquote': return 'blockquote';
    case 'bulletList': return 'bulletList';
    case 'orderedList': return 'orderedList';
    default: return 'other';
  }
}

/** True only when the cursor's top-level block is a convertible textblock (p / h / code). */
export function canTransform(state: EditorState): boolean {
  const n = topBlock(state).type.name;
  return n === 'paragraph' || n === 'heading' || n === 'codeBlock';
}

/**
 * Guard for the wrap/list toggles: true unless the cursor's top-level block is a
 * read-only verbatim atom. Looser than `canTransform` (which allows only p/h/code)
 * so that the toggle stays enabled inside an existing blockquote/list — needed to
 * dissolve it.
 */
export function canWrap(state: EditorState): boolean {
  return topBlock(state).type.name !== 'verbatim';
}

/**
 * Change every convertible top-level textblock the selection touches to `target`,
 * preserving each block's htmlAttrs + range attrs and merging `extraAttrs`.
 * setBlockType is position-stable and strips marks the target disallows. Positions
 * are computed from the (size-stable) original doc.
 */
function setType(target: NodeType, extraAttrs: Record<string, unknown>): Command {
  return (state, dispatch) => {
    if (!canTransform(state)) return false;
    const { $from, $to } = state.selection;
    const fromIdx = $from.index(0);
    const toIdx = $to.index(0);
    if (dispatch) {
      const tr = state.tr;
      let pos = 0;
      for (let i = 0; i < fromIdx; i++) pos += state.doc.child(i).nodeSize;
      for (let i = fromIdx; i <= toIdx; i++) {
        const block = state.doc.child(i);
        if (block.type.isTextblock) {
          const inner = pos + 1;
          tr.setBlockType(inner, inner, target, {
            htmlAttrs: block.attrs.htmlAttrs,
            ...extraAttrs,
            ...rangeAttrs(block),
          });
        }
        pos += block.nodeSize;
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function setHeading(level: number): Command { return setType(heading, { level }); }
export const setParagraph: Command = setType(paragraph, {});
export const toggleCodeBlock: Command = (state, dispatch) => {
  if (currentBlockType(state) === 'codeBlock') return setParagraph(state, dispatch);
  return setType(codeBlock, {})(state, dispatch);
};

// ─── Wrap / unwrap (blockquote + lists, multi-block grouping) ─────────────────

/** Start position of the top-level block at `index`. */
function blockStart(state: EditorState, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize;
  return pos;
}

/**
 * Node range over the TOP-LEVEL block(s) the selection spans (its parent is the
 * doc). Constraining the range's parent to the doc keeps wrapping at the SAME
 * level as detection/dissolve: wrapping a paragraph nested in a container (e.g.
 * a <div>) wraps the top-level container, never nesting a blockquote inside it —
 * which the top-level-only toggle-off could not detect, so re-clicking would
 * nest another blockquote forever.
 */
function topLevelRange(state: EditorState) {
  const { $from, $to } = state.selection;
  return $from.blockRange($to, (node) => node.type === state.doc.type);
}

/** Dissolve the cursor's top-level blockquote: lift ALL its direct children back to top level. */
function unwrapBlockquote(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const index = state.selection.$from.index(0);
  const bq = state.doc.child(index);
  const start = blockStart(state, index);
  // Positions at the blockquote's OWN content level (just inside its open/close),
  // so blockRange's parent is the blockquote and its members are every direct
  // child — regardless of whether those children are textblocks or containers
  // (a `+2`/`-2` offset would descend into a container child, e.g. a <div>, and
  // lift the wrong level).
  const $start = state.doc.resolve(start + 1);
  const $end = state.doc.resolve(start + bq.nodeSize - 1);
  const range = $start.blockRange($end);
  if (!range) return false;
  const target = liftTarget(range);
  if (target == null) return false;
  if (dispatch) dispatch(state.tr.lift(range, target).scrollIntoView());
  return true;
}

/** Wrap the selected top-level block(s) into ONE blockquote (all N as children), or dissolve if already one. */
export const toggleBlockquote: Command = (state, dispatch) => {
  if (!canWrap(state)) return false;
  if (currentBlockType(state) === 'blockquote') return unwrapBlockquote(state, dispatch);
  const range = topLevelRange(state);
  if (!range) return false;
  const wrapping = findWrapping(range, blockquote, rangeAttrs(topBlock(state)));
  if (!wrapping) return false;
  if (dispatch) dispatch(state.tr.wrap(range, wrapping).scrollIntoView());
  return true;
};

/** Dissolve the cursor's top-level list: select across all items, then liftListItem. */
function unwrapList(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const index = state.selection.$from.index(0);
  const list = state.doc.child(index);
  const start = blockStart(state, index);
  const $from = state.doc.resolve(start + 1);
  const $to = state.doc.resolve(start + list.nodeSize - 1);
  const expanded = state.apply(state.tr.setSelection(TextSelection.between($from, $to)));
  return liftListItem(listItem)(expanded, dispatch);
}

/** Convert the cursor's top-level list to `listType` in place (bullet ↔ ordered), preserving items + attrs (incl. blockId → rides the reconciler). */
function convertList(state: EditorState, listType: NodeType, dispatch?: (tr: Transaction) => void): boolean {
  const index = state.selection.$from.index(0);
  const list = state.doc.child(index);
  const pos = blockStart(state, index);
  if (dispatch) dispatch(state.tr.setNodeMarkup(pos, listType, { ...list.attrs }).scrollIntoView());
  return true;
}

/**
 * Wrap the selection's top-level block(s) into ONE list. A multi-block selection
 * groups into N items via wrapInList (already top-level — the blocks are doc
 * siblings). A single top-level block is wrapped at the TOP level via findWrapping
 * (one item), so wrapping a paragraph nested in a container (e.g. a <div>) wraps
 * the container rather than nesting a list inside it — which the top-level-only
 * toggle-off could not dissolve, causing infinite nesting.
 */
function wrapIntoList(state: EditorState, listType: NodeType, dispatch?: (tr: Transaction) => void): boolean {
  const { $from, $to } = state.selection;
  if ($from.index(0) !== $to.index(0)) {
    return wrapInList(listType, rangeAttrs(topBlock(state)))(state, dispatch);
  }
  const range = topLevelRange(state);
  if (!range) return false;
  const wrapping = findWrapping(range, listType, rangeAttrs(topBlock(state)));
  if (!wrapping) return false;
  if (dispatch) dispatch(state.tr.wrap(range, wrapping).scrollIntoView());
  return true;
}

/**
 * Toggle the selected top-level block(s) to a list: dissolve if already `thisType`,
 * convert in place if currently the other list type, else wrap into ONE list.
 */
function toggleListCmd(listType: NodeType, thisType: string, otherType: string): Command {
  return (state, dispatch) => {
    if (!canWrap(state)) return false;
    const { $from, $to } = state.selection;
    const singleBlock = $from.index(0) === $to.index(0);
    const cbt = currentBlockType(state);
    // Dissolve / convert act on the ONE list the cursor is in — only when the
    // selection stays within that single top-level block. A selection spanning
    // into sibling blocks means "group these", so it falls through to wrapIntoList
    // (otherwise convert/dissolve would silently ignore the rest of the selection).
    if (singleBlock && cbt === thisType) return unwrapList(state, dispatch);
    if (singleBlock && cbt === otherType) return convertList(state, listType, dispatch);
    return wrapIntoList(state, listType, dispatch);
  };
}

export const toggleBulletList: Command = toggleListCmd(bulletList, 'bulletList', 'orderedList');
export const toggleOrderedList: Command = toggleListCmd(orderedList, 'orderedList', 'bulletList');

// ─── List indent / outdent (keyboard: Tab / Shift-Tab, wired in HtmlLiveView) ──
export const sinkListItemCmd: Command = sinkListItem(listItem);
export const liftListItemCmd: Command = liftListItem(listItem);
