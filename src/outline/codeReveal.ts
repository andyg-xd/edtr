import { EditorView } from '@codemirror/view';
import type { OutlineEntry } from './types';

/**
 * Jump to `entry` in Code view.
 *
 * The exact surface: a source offset IS a CodeMirror position here, so there
 * is no mapping to get wrong (spec §4.2).
 *
 * The bounds check is not redundant with the caller's freshness guard — it is
 * what keeps THIS function safe if that guard is ever wrong. An out-of-range
 * selection throws, and that throw would come out of a React effect and take
 * the window down; find shipped that crash twice before it was guarded.
 */
export function revealSourceInCode(view: EditorView, entry: OutlineEntry): void {
  const max = view.state.doc.length;
  if (entry.srcFrom < 0 || entry.srcTo > max) return;
  view.dispatch({
    selection: { anchor: entry.srcFrom, head: entry.srcTo },
    effects: EditorView.scrollIntoView(entry.srcFrom, { y: 'center' }),
  });
}
