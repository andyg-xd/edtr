import { Plugin, type Transaction } from 'prosemirror-state';

/**
 * Keeps top-level block ids unique. ProseMirror's `splitBlock` copies a node's
 * attrs to both halves, so the second half inherits the original `blockId` +
 * source range; a freshly inserted block carries the schema default (empty id).
 * This plugin scans top-level blocks front-to-back and reassigns any EMPTY or
 * DUPLICATE id to a fresh `new-N` id (distinct namespace from the parser's
 * `bN`), clearing its source range. Front-to-back means a split's first half
 * keeps the original id/range and the second becomes "new" — the invariant the
 * reconciler relies on ("a block is new iff its id is not in the baseline").
 */
export function blockIdentityPlugin(): Plugin {
  let counter = 0;
  const freshId = () => `new-${counter++}`;
  return new Plugin({
    appendTransaction(_trs, _oldState, newState) {
      const seen = new Set<string>();
      let tr: Transaction | null = null;
      newState.doc.forEach((block, offset) => {
        const id = block.attrs.blockId as string;
        if (id === '' || seen.has(id)) {
          const newId = freshId();
          tr = (tr ?? newState.tr).setNodeMarkup(offset, undefined, {
            ...block.attrs,
            blockId: newId,
            srcFrom: 0,
            srcTo: 0,
          });
          seen.add(newId);
        } else {
          seen.add(id);
        }
      });
      return tr ?? undefined;
    },
  });
}
