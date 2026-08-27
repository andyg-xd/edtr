import type { EditorView } from 'prosemirror-view';
import type { OutlineEntry } from './types';

/**
 * The document's headings, read straight off the live ProseMirror document.
 *
 * WHY THIS EXISTS (A5, owner's GUI pass 2026-08-26). The outline was derived
 * from `session.text` in every view, per spec D2's "one source-derived list".
 * But in a Live view `session.text` is only updated by `flushToSource`, which
 * runs on save and on a view toggle — never per transaction. So typing a
 * heading changed nothing in the panel until something forced a flush, and the
 * heading appeared only after a switch to Code view. The memo was re-running
 * correctly the whole time; its INPUT was what had not changed.
 *
 * Flushing on every keystroke was rejected: it would put the whole write-back
 * and serialize path — the no-beautify path — in the hot path of typing.
 *
 * So D2 weakens from "one derivation" to "one list, two derivations", and
 * `liveOutline.test.ts` holds the two to agreement on an unedited document.
 * That agreement test is the condition the owner attached to the decision, not
 * a nicety.
 *
 * Both schemas name the node `heading` and carry `attrs.level` (liveSchema.ts,
 * htmlSchema.ts), so one walk serves Markdown and HTML alike.
 *
 * This reads the document and never dispatches. `noWritePath.test.ts` holds the
 * outline to that.
 */
export function buildLiveOutline(view: EditorView): OutlineEntry[] {
  const entries: OutlineEntry[] = [];

  // `descendants` walks in document order and reaches nested blocks, which is
  // the point: a heading inside a <section> has no source range of its own
  // (spec §4.2), and that is exactly what the source-derived path needs an
  // ordinal to work around. Walking the live tree reaches it directly.
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true;
    entries.push({
      // Unique because two nodes cannot share a position. The panel marks the
      // active entry by id, so a duplicate would mark two rows at once.
      id: `live:${pos}`,
      level: Number(node.attrs?.level ?? 1),
      text: node.textContent,
      // Not positions on a live-derived entry, and deliberately zero rather
      // than plausible-looking: a stale source offset that merely LOOKS valid
      // would resolve to the wrong place instead of failing visibly.
      srcFrom: 0, srcTo: 0, ordinalInBlock: 0, blockFrom: 0, blockTo: 0,
      pmPos: pos,
    });
    // A heading cannot contain another heading; no reason to walk inside it.
    return false;
  });

  return entries;
}

/**
 * Which live-derived entry the caret sits in — the last heading at or before it.
 *
 * The PM-position twin of `activeEntryIndex`, and EXACT where that one is not.
 * The source-offset version has to answer for a caret inside a container with
 * the CONTAINER's offset, which starts before the heading it holds, so it marks
 * the previous heading instead. That defect is invisible in Markdown (every
 * heading is top-level) and was found by test on 2026-08-26 rather than by the
 * GUI pass, which walked the case on Markdown.
 */
export function activeLiveEntryIndex(entries: OutlineEntry[], caretPos: number): number | null {
  let active: number | null = null;
  for (let i = 0; i < entries.length; i++) {
    const pos = entries[i].pmPos;
    if (pos === undefined) break;
    if (pos <= caretPos) active = i;
    else break;
  }
  return active;
}
