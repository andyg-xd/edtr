import { TextSelection, type Command } from 'prosemirror-state';
import { chainCommands, newlineInCode, splitBlock, liftEmptyBlock } from 'prosemirror-commands';
import { splitListItem } from 'prosemirror-schema-list';
import { liveSchema } from '../views/liveSchema';

/** Shift-Enter: a within-block soft break (a newline inside code blocks). */
export const insertHardBreak: Command = (state, dispatch) => {
  const br = liveSchema.nodes.hardBreak.create();
  if (dispatch) dispatch(state.tr.replaceSelectionWith(br).scrollIntoView());
  return true;
};

/** Shift-Enter chain: newline in code, else a hard break. */
export const softBreakCommand: Command = chainCommands(newlineInCode, insertHardBreak);

/**
 * Enter: standard WYSIWYG split. Code block → newline; list item → new item /
 * empty item lifts out of the list; empty block → lift; otherwise split the
 * textblock (end-of-heading yields a paragraph via splitBlock's default block).
 */
export const splitCommand: Command = chainCommands(
  newlineInCode,
  splitListItem(liveSchema.nodes.listItem),
  liftEmptyBlock,
  splitBlock,
);

/**
 * Insert a horizontal rule after the current top-level block, followed by an
 * empty paragraph, with the cursor placed in that paragraph.
 */
export const insertHorizontalRule: Command = (state, dispatch) => {
  const { horizontalRule, paragraph } = liveSchema.nodes;
  // Clamp to the last block: an AllSelection (⌘A) / cursor at the doc end gives
  // $to.index(0) === childCount, and doc.child(childCount) throws (RangeError).
  const index = Math.min(state.selection.$to.index(0), state.doc.childCount - 1);
  let end = 0;
  for (let i = 0; i <= index; i++) end += state.doc.child(i).nodeSize;
  if (dispatch) {
    const hr = horizontalRule.create();
    const para = paragraph.create();
    const tr = state.tr.insert(end, [hr, para]);
    tr.setSelection(TextSelection.create(tr.doc, end + hr.nodeSize + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};
