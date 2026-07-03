import { type Command, type EditorState } from 'prosemirror-state';
import type { NodeType, Node as PMNode } from 'prosemirror-model';
import { htmlSchema } from '../views/htmlSchema';

const { paragraph, heading, codeBlock } = htmlSchema.nodes;

/**
 * Meta key marking a trusted, count/order-preserving block type-transform.
 * htmlStructureLockPlugin permits any tx carrying it (see Task 2).
 */
export const BLOCK_TRANSFORM = 'htmlBlockTransform';

function topBlock(state: EditorState): PMNode {
  const { $from } = state.selection;
  return state.doc.child($from.index(0));
}
function rangeAttrs(node: PMNode) {
  return { srcFrom: node.attrs.srcFrom, srcTo: node.attrs.srcTo, blockId: node.attrs.blockId };
}

/** Type of the cursor's top-level block: 'h{n}' | 'paragraph' | 'codeBlock' | 'other'. */
export function currentBlockType(state: EditorState): string {
  const node = topBlock(state);
  switch (node.type.name) {
    case 'heading': return `h${node.attrs.level as number}`;
    case 'paragraph': return 'paragraph';
    case 'codeBlock': return 'codeBlock';
    default: return 'other';
  }
}

/** True only when the cursor's top-level block is a convertible textblock (p / h / code). */
export function canTransform(state: EditorState): boolean {
  const n = topBlock(state).type.name;
  return n === 'paragraph' || n === 'heading' || n === 'codeBlock';
}

/**
 * Change every convertible top-level textblock the selection touches to `target`,
 * preserving each block's htmlAttrs + range attrs and merging `extraAttrs`.
 * setBlockType is position-stable and strips marks the target disallows. Tags the
 * tx BLOCK_TRANSFORM so the structure lock permits it. Positions are computed from
 * the (size-stable) original doc.
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
      tr.setMeta(BLOCK_TRANSFORM, true);
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
