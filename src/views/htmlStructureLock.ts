import { Plugin } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { BLOCK_TRANSFORM } from '../commands/htmlBlockCommands';

/** Signature of the top-level block sequence: type + id, order-sensitive. */
function topLevelSig(doc: PMNode): string {
  const parts: string[] = [];
  doc.forEach((b) => parts.push(`${b.type.name}#${b.attrs.blockId as string}`));
  return parts.join('|');
}

/**
 * Rejects any doc-changing transaction that alters the top-level block count,
 * type, or order — enforcing within-block-only editing in 4b. The per-block-
 * splice write-back requires stable structure (a merge/delete would corrupt it).
 * Text edits, mark changes, and hardBreak inserts keep the signature → allowed.
 * (Analog of Markdown's 3b structureLockPlugin; removed in 4d when structural
 * editing + the reconstruction reconciler land.)
 */
export function htmlStructureLockPlugin(): Plugin {
  return new Plugin({
    filterTransaction(tr, state) {
      if (!tr.docChanged) return true;
      // 4c: trusted in-place type transforms (heading/paragraph/code block) keep
      // top-level count + order + blockId; they only flip a block's type, which the
      // signature check would otherwise reject. Permit them explicitly.
      if (tr.getMeta(BLOCK_TRANSFORM)) return true;
      return topLevelSig(tr.doc) === topLevelSig(state.doc);
    },
  });
}
