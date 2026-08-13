import type { EditorView as CmView } from '@codemirror/view';
import type { EditorView as PmView } from 'prosemirror-view';
import type { CountSurface } from './types';

/**
 * Counting over Code view: the raw buffer, `**` and tags included (D2). The
 * number here legitimately differs from the Live view's for the same file.
 */
export function codeCounts(view: CmView): CountSurface {
  return {
    countableText: () => view.state.doc.toString(),
    selectedText() {
      const { from, to } = view.state.selection.main;
      return from === to ? '' : view.state.sliceDoc(from, to);
    },
  };
}

/**
 * Counting over a Live view: the rendered text (D2).
 *
 * The `'\n', '\n'` separators are load-bearing. `textBetween` with no
 * separator fuses the last word of one block to the first of the next, which
 * is the same class of bug `flattenBlocks` avoids for `hardBreak` and does not
 * avoid for skipped atoms. `find/pmSurface.ts:154` already passes these; keep
 * the two consistent.
 *
 * A `<script>` or `<style>` body is a node attribute rather than text in HTML
 * Live, so it does not count here while it does in Code view. That is D2
 * working as chosen, recorded in spec §4.1.
 */
export function pmCounts(view: PmView): CountSurface {
  return {
    countableText: () => view.state.doc.textBetween(0, view.state.doc.content.size, '\n', '\n'),
    selectedText() {
      const { from, to, empty } = view.state.selection;
      return empty ? '' : view.state.doc.textBetween(from, to, '\n', '\n');
    },
  };
}
