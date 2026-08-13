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
 */
export function focusDimPlugin(): Plugin<FocusState> {
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
        const active = activeBlock(textblockRanges(state.doc), state.selection.head);
        const decos: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (!node.isTextblock) return true;
          // A null `active` (caret between blocks, empty doc) dims everything,
          // which is correct: there is no active block to light.
          if (active && pos + 1 === active.from) return false;
          decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'edtr-dim' }));
          return false;
        });
        return DecorationSet.create(state.doc, decos);
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
