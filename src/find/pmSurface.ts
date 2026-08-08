import { Mark, type Node as PMNode } from 'prosemirror-model';
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
                // `<edtr-mark>`, NOT the default `<span>`. HTML Live renders
                // the file's own CSS by design, so a bare span is a selector
                // collision waiting to happen: a real document styling
                // `ul.notice li span{position:absolute;...}` to place a `→`
                // bullet caught our highlight too and lifted the matched word
                // out of its sentence onto the arrow. Source order is no
                // defence — that selector simply outranks `.edtr-find` — but a
                // custom element name the file cannot know about is. Decorations
                // are view-only and never serialised, so this cannot reach the
                // file (no-beautify, design §6).
                nodeName: 'edtr-mark',
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
 * Whether `[from, to)` contains more than one set of marks.
 *
 * This is what decides D2's notice. It compares each text node's marks against
 * the marks at the match start rather than counting nodes, because a range can
 * be split across several text nodes that all carry identical marks (a
 * re-parse, an image between two runs) and that is not a formatting boundary.
 */
function spansFormattingBoundary(doc: PMNode, from: number, to: number): boolean {
  const startMarks = doc.resolve(from + 1 <= to ? from + 1 : from).marks();
  let crossed = false;
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText || crossed) return;
    if (!Mark.sameSet(node.marks, startMarks)) crossed = true;
  });
  return crossed;
}

/**
 * Find over a Live view — Markdown or HTML, the SAME code for both. That
 * sharing is why HTML Live costs almost nothing beyond excluding its verbatim
 * regions, and it is the design's main load-bearing claim (§5.2). Do not add an
 * HTML-specific branch here.
 *
 * Searches the VISIBLE text, flattened per visible block: in Live view the
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
      // reveal is not worth a crash, so it does nothing instead. The caller
      // (DocumentView's `findFresh` guard) already refuses to pass a stale
      // match under normal operation -- this check is defense in depth, not
      // redundant with it, since it is what keeps THIS surface safe if that
      // guard is ever wrong.
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
      view.dispatch(tr.setSelection(selection));
      // Scroll EXPLICITLY, rather than with the `tr.scrollIntoView()` that
      // would be the obvious thing to chain on above. ProseMirror starts that
      // scroll from the DOM selection's focusNode and, when that node is not
      // inside the editor, does nothing at all -- silently (prosemirror-view's
      // `scrollToSelection`). Focus belongs to the find field for every
      // keystroke and every Cmd-G, so that branch is ALWAYS the one taken here:
      // the match was found, counted and highlighted, and the viewport never
      // moved. Code view is unaffected -- CodeMirror scrolls from a document
      // position, not from the DOM selection -- so this is the one surface that
      // has to do it itself.
      //
      // `side: 1` biases into the text, so this is the innermost inline box
      // around the match (the highlight span, once one is rendered) rather than
      // the enclosing block: the difference between landing on the word and
      // landing on a paragraph that may be taller than the window.
      const { node } = view.domAtPos(match.from, 1);
      const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      // Centred, to match what Code view already does for the same gesture.
      // `scrollIntoView` is absent under jsdom and present in every real
      // browser, which is why no test could see the bug this replaced.
      el?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    },
    editable: () => view.editable,
    applyEdits(edits) {
      if (edits.length === 0) return { crossedFormatting: false };
      const { tr } = view.state;
      let crossed = false;
      // Apply DESCENDING so each edit's positions are still valid when it runs
      // — an earlier replacement of a different length would otherwise shift
      // every position after it.
      for (let i = edits.length - 1; i >= 0; i--) {
        const e = edits[i];
        if (e.from < 0 || e.to > tr.doc.content.size) continue;
        if (spansFormattingBoundary(tr.doc, e.from, e.to)) crossed = true;
        // Marks from the START of the match (D2). Taken at from+1 because a
        // position at a text node's boundary resolves to the marks before it.
        const marks = tr.doc.resolve(Math.min(e.from + 1, e.to)).marks();
        if (e.text === '') tr.delete(e.from, e.to);
        else tr.replaceWith(e.from, e.to, view.state.schema.text(e.text, marks));
      }
      view.dispatch(tr);
      return { crossedFormatting: crossed };
    },
  };
}
