import { TextSelection, type Command } from 'prosemirror-state';
import { chainCommands, newlineInCode, splitBlock, liftEmptyBlock } from 'prosemirror-commands';
import { splitListItem } from 'prosemirror-schema-list';
import { htmlSchema } from '../views/htmlSchema';
import { softBreak } from './htmlInlineCommands';

/** Shift-Enter: newline inside a code block, else a soft break (<br>). */
export const softBreakCommand: Command = chainCommands(newlineInCode, softBreak);

/**
 * Enter: standard WYSIWYG split. Code block → newline; list item → new item
 * (empty item lifts out); empty block → lift; otherwise split the textblock
 * (end-of-heading yields a paragraph via splitBlock's default block).
 */
export const splitCommand: Command = chainCommands(
  newlineInCode,
  splitListItem(htmlSchema.nodes.listItem),
  liftEmptyBlock,
  splitBlock,
);

/**
 * Insert an <hr> after the current top-level block, followed by an empty
 * paragraph, with the cursor placed in that paragraph.
 */
export const insertHorizontalRule: Command = (state, dispatch) => {
  const { horizontalRule, paragraph } = htmlSchema.nodes;
  const index = state.selection.$to.index(0);
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
