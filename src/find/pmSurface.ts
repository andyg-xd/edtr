import { Mark, type Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { flattenBlocks, SKIP_ATOMS } from './flattenBlocks';
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

/** What one walk of `[from, to)` reports back to both `applyEdits` and `inspectEdits`. */
interface RangeInspection {
  /**
   * Marks of the node that contains the character AT `from` — not
   * `doc.resolve(from).marks()`. `ResolvedPos.marks()` filters OUT a
   * non-inclusive mark (`link` is `inclusive: false` in both schemas)
   * whenever the resolved position's `textOffset` is 0, which is exactly
   * what happens when a match starts on the LAST character of a marked run:
   * resolving just past that character reads as "before the next run", not
   * "inside this one", so the very mark the match starts on disappears.
   * `nodeAt` has no such filter — it just returns whichever node's range
   * contains the position — so it is both what a replacement should inherit
   * (D2) and the correct baseline `crossedFormatting` compares against.
   */
  startMarks: readonly Mark[];
  /** Whether `[from, to)` contains more than one set of marks (D2's notice). */
  crossedFormatting: boolean;
  /**
   * How many `image` nodes sit inside `[from, to)` — invisible in the
   * flattened text a match was found in, so removing one must be disclosed
   * (D6, spec §K5) rather than assumed benign. Counted separately from
   * `removedEmbedded` below because ONLY an image's file survives the edit
   * (it lives in the assets folder, untouched); the disclosure the caller
   * builds from these two counts must not say that about the other kind.
   */
  removedImages: number;
  /**
   * How many `verbatim`/`inlineVerbatim` nodes (raw HTML Edtr cannot parse —
   * an `<abbr>`, an inline `<svg>`, a `<script>`-shaped block, ...) sit
   * inside `[from, to)`. Unlike an image, this content has no file of its
   * own anywhere: removing it from the document removes it, full stop.
   */
  removedEmbedded: number;
}

/**
 * The one walk `applyEdits` and `inspectEdits` both need over `[from, to)`.
 *
 * Written once rather than as three separate `nodesBetween` calls (one for
 * formatting, one for the atom count in `applyEdits`, one again in
 * `inspectEdits`) so the two questions can never quietly diverge — e.g. one
 * traversal learning to skip `hardBreak` and the other forgetting to.
 *
 * Compares each text node's raw marks against `startMarks` rather than
 * counting distinct mark sets, because a range can be split across several
 * text nodes that all carry identical marks (a re-parse, an image between two
 * runs) and that is not a formatting boundary.
 */
function inspectRange(doc: PMNode, from: number, to: number): RangeInspection {
  const startMarks = doc.nodeAt(from)?.marks ?? Mark.none;
  let crossedFormatting = false;
  let removedImages = 0;
  let removedEmbedded = 0;
  doc.nodesBetween(from, to, (node) => {
    if (node.isText) {
      if (!crossedFormatting && !Mark.sameSet(node.marks, startMarks)) crossedFormatting = true;
      return;
    }
    // `image` gets its own bucket — see `RangeInspection`'s doc comment for
    // why the survival claim can only be made for that one kind.
    if (node.type.name === 'image') removedImages += 1;
    else if (SKIP_ATOMS.has(node.type.name)) removedEmbedded += 1;
  });
  return { startMarks, crossedFormatting, removedImages, removedEmbedded };
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
      if (edits.length === 0) return { crossedFormatting: false, removedImages: 0, removedEmbedded: 0 };
      const { tr } = view.state;
      let crossed = false;
      let removedImages = 0;
      let removedEmbedded = 0;
      // Apply DESCENDING so each edit's positions are still valid when it runs
      // — an earlier replacement of a different length would otherwise shift
      // every position after it.
      for (let i = edits.length - 1; i >= 0; i--) {
        const e = edits[i];
        // A stale edit can point past the document `computeReplacements` saw
        // — same defense-in-depth posture as `reveal` above, and for the same
        // reason: an out-of-range `replaceWith`/`delete` throws, and that
        // throw would come out of whatever handler Task 5 wires the Replace
        // button to.
        if (e.from < 0 || e.to > tr.doc.content.size) continue;
        const inspection = inspectRange(tr.doc, e.from, e.to);
        if (inspection.crossedFormatting) crossed = true;
        removedImages += inspection.removedImages;
        removedEmbedded += inspection.removedEmbedded;
        if (e.text === '') tr.delete(e.from, e.to);
        // schema.text('') throws — replacing with nothing is legitimate (the
        // user cleared the replace field), so it takes the delete path above
        // instead. Otherwise, the inserted text carries `startMarks` (D2):
        // marks from the START of the match, not wherever it ends.
        else tr.replaceWith(e.from, e.to, view.state.schema.text(e.text, inspection.startMarks));
      }
      // Every edit may have been skipped by the bounds guard above — nothing
      // to dispatch, and an empty-steps transaction would still cost a no-op
      // history entry and a redundant `dirtyTracking` look if it went through.
      if (!tr.docChanged) return { crossedFormatting: false, removedImages: 0, removedEmbedded: 0 };
      view.dispatch(tr);
      return { crossedFormatting: crossed, removedImages, removedEmbedded };
    },
    inspectEdits(edits) {
      // Read-only: walks `view.state.doc` directly rather than building a
      // `tr`, and never dispatches. Unlike `applyEdits`, order doesn't matter
      // here — nothing mutates between edits, so every edit's positions stay
      // valid against the same unchanged document regardless of what order
      // they're inspected in.
      let atomSpans = 0;
      for (const e of edits) {
        if (e.from < 0 || e.to > view.state.doc.content.size) continue;
        const inspection = inspectRange(view.state.doc, e.from, e.to);
        // Not split by kind here — the pre-commit guard this feeds makes no
        // survival claim either way (see `ReplaceAllGuard`), so one total is
        // enough. `applyEdits` above is what needs the breakdown.
        if (inspection.removedImages + inspection.removedEmbedded > 0) atomSpans += 1;
      }
      return { atomSpans };
    },
  };
}
