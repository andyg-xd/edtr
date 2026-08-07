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
      view.dispatch({
        selection: { anchor: match.from, head: match.to },
        effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
      });
    },
  };
}
