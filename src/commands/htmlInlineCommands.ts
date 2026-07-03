import { toggleMark } from 'prosemirror-commands';
import type { Command } from 'prosemirror-state';
import { htmlSchema } from '../views/htmlSchema';
import { markActive, getMarkRange } from './markdownInlineCommands';

// Re-export the schema-generic helper so ribbon/consumers import from one place.
export { markActive };

const { strong, em, underline, strike, code, link } = htmlSchema.marks;

export const toggleStrong: Command = toggleMark(strong);
export const toggleEm: Command = toggleMark(em);
export const toggleUnderline: Command = toggleMark(underline);
export const toggleStrike: Command = toggleMark(strike);
export const toggleCode: Command = toggleMark(code);

/** Read-only check (call without dispatch) that a link can be applied here. */
export const canLink: Command = toggleMark(link);

/** Replace the selection with `text` carrying a link mark to `href`. */
export function applyLink(href: string, text: string): Command {
  return (state, dispatch) => {
    if (!href) return false;
    const { from, to } = state.selection;
    const content = state.schema.text(text || href, [link.create({ htmlAttrs: { href } })]);
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
    if (empty) { const r = getMarkRange($from, link); if (r) range = r; }
    dispatch(state.tr.removeMark(range.from, range.to, link));
  }
  return true;
};

/** Enter / Shift-Enter: within-block soft break (a <br>). */
export const softBreak: Command = (state, dispatch) => {
  const br = htmlSchema.nodes.hardBreak.create();
  if (dispatch) dispatch(state.tr.replaceSelectionWith(br).scrollIntoView());
  return true;
};
