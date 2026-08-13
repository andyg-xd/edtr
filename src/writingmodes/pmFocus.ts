import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { activeBlock } from './activeBlock';
import type { BlockRange, FocusSurface } from './types';

interface FocusState { enabled: boolean }

const focusKey = new PluginKey<FocusState>('edtrFocusMode');
const FOCUS_META = 'edtrFocusEnabled';

/**
 * Content ranges of every INNERMOST textblock (spec §5.2).
 *
 * Innermost matters: an HTML `<section>` holding three paragraphs must dim two
 * of them and light one, so the container is never the lit unit. Same rule
 * `flattenBlocks` uses, so focus mode and find cannot disagree about what a
 * block is.
 */
export function textblockRanges(doc: PMNode): BlockRange[] {
  const ranges: BlockRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    ranges.push({ from: pos + 1, to: pos + 1 + node.content.size });
    return false;
  });
  return ranges;
}

/**
 * Dims every block but the caret's.
 *
 * Decorations are DERIVED from state in `props.decorations` rather than stored
 * and updated by transaction, so a caret move needs no dispatch at all — the
 * only transaction this plugin ever sees is the enable/disable meta. That is
 * the strongest available no-beautify position: with no steps anywhere,
 * `tr.docChanged` is false and dirty tracking has nothing to observe.
 *
 * `props.decorations` runs on every state update — every keystroke and every
 * selection move — and is memoised across calls for that reason. The
 * decoration set depends on nothing but (document identity, active block's
 * start): two closures below cache each of the two walks separately, since
 * `textblockRanges` depends only on the document while the decoration set
 * also depends on the selection. The Code-view twin (`codeFocus.ts`) bounds
 * the identical job to `view.visibleRanges` instead; ProseMirror has no such
 * viewport concept, so memoisation is the equivalent fix here — a caret move
 * that stays inside the same block, or any update that touches neither the
 * document nor the active block, now costs zero walks instead of two full
 * `doc.descendants` traversals.
 */
export function focusDimPlugin(): Plugin<FocusState> {
  // Closed over for the life of this plugin instance (one per mounted view —
  // `focusDimPlugin()` is called fresh at each view's construction, so this
  // cache is never shared across documents).
  let rangesDoc: PMNode | null = null;
  let ranges: BlockRange[] = [];
  let lastDoc: PMNode | null = null;
  let lastActiveFrom: number | null = null;
  let lastSet: DecorationSet = DecorationSet.empty;

  return new Plugin<FocusState>({
    key: focusKey,
    state: {
      init: () => ({ enabled: false }),
      apply(tr, value) {
        const next = tr.getMeta(FOCUS_META) as boolean | undefined;
        return next === undefined ? value : { enabled: next };
      },
    },
    props: {
      decorations(state) {
        if (!focusKey.getState(state)?.enabled) return DecorationSet.empty;
        if (state.doc !== rangesDoc) {
          rangesDoc = state.doc;
          ranges = textblockRanges(state.doc);
        }
        const active = activeBlock(ranges, state.selection.head);
        // A null `active` (caret between blocks, empty doc) dims everything,
        // which is correct: there is no active block to light.
        const activeFrom = active ? active.from : null;
        if (state.doc === lastDoc && activeFrom === lastActiveFrom) return lastSet;
        const decos: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (!node.isTextblock) return true;
          if (activeFrom !== null && pos + 1 === activeFrom) return false;
          decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'edtr-dim' }));
          return false;
        });
        lastDoc = state.doc;
        lastActiveFrom = activeFrom;
        lastSet = DecorationSet.create(state.doc, decos);
        return lastSet;
      },
    },
  });
}

/** Install `focusDimPlugin()` in both Live views' plugin lists for this to work. */
export function pmFocus(view: EditorView): FocusSurface {
  return {
    setFocusEnabled(on) {
      view.dispatch(view.state.tr.setMeta(FOCUS_META, on));
    },
  };
}
