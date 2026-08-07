import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { flattenBlocks } from './flattenBlocks';
import type { FindMatch, FindSurface } from './types';

interface FindDecoState {
  deco: DecorationSet;
}

const findKey = new PluginKey<FindDecoState>('edtrFind');

/** Transaction meta carrying a new highlight set. Meta only — never a step. */
const FIND_META = 'edtrFindHighlights';

/**
 * Holds find highlights as ProseMirror decorations.
 *
 * Decorations are view-level: this plugin never changes the document, and a
 * highlight transaction carries meta and no steps, so `tr.docChanged` is false
 * and dirtyTracking — which returns its previous value unless the doc changed —
 * cannot see it. That invariant is asserted by test, not assumed (design §6).
 *
 * Install it in BOTH the editable and read-only plugin lists: find must work in
 * a read-only HTML preview, and an empty plugin list means no decorations.
 */
export function findDecorationsPlugin(): Plugin<FindDecoState> {
  return new Plugin<FindDecoState>({
    key: findKey,
    state: {
      init: () => ({ deco: DecorationSet.empty }),
      apply(tr, value) {
        const payload = tr.getMeta(FIND_META) as
          | { matches: FindMatch[]; current: number }
          | undefined;
        if (payload) {
          const { matches, current } = payload;
          return {
            deco: DecorationSet.create(
              tr.doc,
              matches.map((m, i) => Decoration.inline(m.from, m.to, {
                class: i === current ? 'edtr-find edtr-find-current' : 'edtr-find',
              })),
            ),
          };
        }
        // Map through document changes so highlights follow their text rather
        // than pointing at whatever has since moved into those positions.
        return { deco: value.deco.map(tr.mapping, tr.doc) };
      },
    },
    props: {
      decorations: (state) => findKey.getState(state)?.deco ?? DecorationSet.empty,
    },
  });
}

/**
 * Find over a Live view — Markdown or HTML, the SAME code for both. That
 * sharing is why HTML Live costs almost nothing beyond excluding its verbatim
 * regions, and it is the design's main load-bearing claim (§5.2). Do not add an
 * HTML-specific branch here.
 *
 * Searches the VISIBLE text, flattened per top-level block: in Live view the
 * user would otherwise be searching bytes they cannot see (`**`, tags,
 * attribute text), and a highlight could land inside markup with no visual
 * counterpart.
 */
export function pmSurface(view: EditorView): FindSurface {
  return {
    // Per-block segments ⇒ ^/$ anchor to BLOCKS here (design §5.3).
    multiline: false,
    getSegments: () => flattenBlocks(view.state.doc),
    cursorPos: () => view.state.selection.head,
    selectedText() {
      const { from, to, empty } = view.state.selection;
      return empty ? '' : view.state.doc.textBetween(from, to, '\n', '\n');
    },
    highlight(matches, current) {
      view.dispatch(view.state.tr.setMeta(FIND_META, { matches, current }));
    },
    reveal(match) {
      // A match can outlive the document it was computed against -- the
      // caller debounces its recompute, so a match is always momentarily
      // able to describe a document version that no longer exists (an edit,
      // or a Code<->Live toggle to a shorter projection). `.resolve()` throws
      // a RangeError on an out-of-bounds position, and that throw would come
      // out of a passive effect and take the whole window down. A stale
      // reveal is not worth a crash, so it does nothing instead.
      if (match.from < 0 || match.to > view.state.doc.content.size) return;
      const { tr } = view.state;
      // `between`, not `create`: `between` resolves whatever it is given to
      // the nearest selectable pair, so reveal cannot throw on an endpoint the
      // schema will not accept as a text selection. For the matches
      // flattenBlocks produces today, both endpoints always land in inline
      // content and `create` would accept them too -- this is tolerance we are
      // not currently relying on, kept because reveal must never be the thing
      // that breaks find. (Verified empirically: a match spanning an inline
      // image resolves to endpoints `create` accepts.)
      const selection = TextSelection.between(
        tr.doc.resolve(match.from),
        tr.doc.resolve(match.to),
      );
      view.dispatch(tr.setSelection(selection).scrollIntoView());
    },
  };
}
