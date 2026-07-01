import type { Command, EditorState } from 'prosemirror-state';
import type { NodeType } from 'prosemirror-model';
import { liveSchema } from '../views/liveSchema';

/** Meta key marking a transaction as a trusted block-transform (the structure lock permits these). */
export const BLOCK_TRANSFORM = 'edtrBlockTransform';

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
      tr.setMeta(BLOCK_TRANSFORM, true);
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
