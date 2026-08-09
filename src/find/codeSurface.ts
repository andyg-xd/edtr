import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { identityMap, type FindMatch, type FindSurface, type Segment } from './types';

const matchMark = Decoration.mark({ class: 'cm-edtr-find' });
const currentMark = Decoration.mark({ class: 'cm-edtr-find-current' });

/** Replace the whole highlight set. Carries no document change of any kind. */
export const setFindHighlights = StateEffect.define<{ matches: FindMatch[]; current: number }>();

/**
 * Holds the find highlights.
 *
 * It MAPS through document changes so highlights stay on their text while the
 * user types, rather than pointing at whatever has since moved into those
 * offsets. And it is decoration only: no transaction this field takes part in
 * changes the document, which is what makes 6c-i-a incapable of touching a file
 * (no-beautify, design §6).
 */
export const findHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setFindHighlights)) {
        const { matches, current } = effect.value;
        next = Decoration.set(
          matches.map((m, i) => (i === current ? currentMark : matchMark).range(m.from, m.to)),
          true, // sort — matches arrive in order, but say so rather than rely on it
        );
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Find over Code view. ONE segment: the whole source, including the `**` and
 * the tags a Live view hides. Positions are character offsets, so the offset
 * map is the identity.
 */
export function codeSurface(view: EditorView): FindSurface {
  return {
    // One whole-document segment ⇒ ^/$ anchor to LINES here (design §5.3).
    multiline: true,
    getSegments(): Segment[] {
      const text = view.state.doc.toString();
      return [{ text, map: identityMap(text.length) }];
    },
    cursorPos: () => view.state.selection.main.head,
    selectedText() {
      const { from, to } = view.state.selection.main;
      return from === to ? '' : view.state.sliceDoc(from, to);
    },
    highlight(matches, current) {
      view.dispatch({ effects: setFindHighlights.of({ matches, current }) });
    },
    reveal(match) {
      // A match can outlive the document it was computed against -- the
      // caller debounces its recompute, so a match is always momentarily able
      // to describe a document version that no longer exists (an edit, or a
      // Live<->Code toggle to a shorter projection). CodeMirror rejects an
      // out-of-range selection, and that throw would come out of a passive
      // effect and take the whole window down. A stale reveal is not worth a
      // crash, so it does nothing instead. The caller (DocumentView's
      // `findFresh` guard) already refuses to pass a stale match under normal
      // operation -- this check is defense in depth, not redundant with it,
      // since it is what keeps THIS surface safe if that guard is ever wrong.
      if (match.from < 0 || match.to > view.state.doc.length) return;
      view.dispatch({
        selection: { anchor: match.from, head: match.to },
        effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
      });
    },
    editable: () => view.state.facet(EditorView.editable),
    applyEdits(edits) {
      // Filter against the current document length for the same reason
      // `reveal` above does: a stale edit computed against an older document
      // can arrive here pointing past the end of the current one, and
      // `ChangeSet.of` throws a `RangeError` on an out-of-range change —
      // which would come out of whatever handler Task 5 wires the Replace
      // button to, rather than out of a passive effect, but the crash is the
      // same shape and just as worth not having.
      const valid = edits.filter((e) => e.from >= 0 && e.to <= view.state.doc.length);
      if (valid.length === 0) return { crossedFormatting: false, removedImages: 0, removedEmbedded: 0 };
      // CodeMirror maps a changeset's positions itself, so ascending edits are
      // applied correctly in one transaction and one undo step.
      view.dispatch({
        changes: valid.map((e) => ({ from: e.from, to: e.to, insert: e.text })),
      });
      // Code view's source is plain text: there is no formatting to cross,
      // and no atom concept for an edit to silently remove.
      return { crossedFormatting: false, removedImages: 0, removedEmbedded: 0 };
    },
    // Plain text has no atom concept either — always zero, unconditionally.
    inspectEdits: () => ({ atomSpans: 0 }),
  };
}
