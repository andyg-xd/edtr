import { toggleMark } from 'prosemirror-commands';
import type { Command, EditorState } from 'prosemirror-state';
import { htmlSchema } from '../views/htmlSchema';
import { markActive, getMarkRange, canInsert } from './markdownInlineCommands';

// Re-export the schema-generic helpers so ribbon/consumers import from one place.
export { markActive, canInsert };

const { strong, em, underline, strike, code, link } = htmlSchema.marks;
const { image } = htmlSchema.nodes;

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

/**
 * Insert an inline <img> at the selection. `src` is the verbatim (relative)
 * path written to source; `displaySrc` is render-only (asset-protocol URL).
 */
export function insertImage(
  src: string,
  alt: string | null = null,
  displaySrc: string | null = null,
): Command {
  return (state, dispatch) => {
    if (!src || !canInsert(state, image)) return false;
    const htmlAttrs: Record<string, string> = alt ? { src, alt } : { src };
    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(image.create({ htmlAttrs, displaySrc })).scrollIntoView());
    }
    return true;
  };
}

/** True if an <img> node can be inserted at the current selection (HTML live). */
export function canInsertImage(state: EditorState): boolean {
  return canInsert(state, image);
}
