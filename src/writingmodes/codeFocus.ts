import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { FocusSurface } from './types';

/** Turn Code view's dimming on or off. Carries no document change. */
export const setFocusDim = StateEffect.define<boolean>();

const focusEnabled = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFocusDim)) return e.value;
    return value;
  },
});

const dimLine = Decoration.line({ class: 'cm-edtr-dim' });

/**
 * Only VISIBLE lines are decorated. A blanket colour on `.cm-content` cannot
 * work — syntax highlighting sets a colour on each token, which would win — so
 * dimming has to be a per-line decoration, and decorating every line of a
 * 10,000-line file on each keystroke would stall the editor. `visibleRanges`
 * bounds the work to the viewport.
 */
function build(view: EditorView): DecorationSet {
  if (!view.state.field(focusEnabled)) return Decoration.none;
  const activeFrom = view.state.doc.lineAt(view.state.selection.main.head).from;
  const ranges = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      if (line.from !== activeFrom) ranges.push(dimLine.range(line.from));
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

const dimPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(u: ViewUpdate) {
      if (
        u.docChanged || u.selectionSet || u.viewportChanged ||
        u.transactions.some((t) => t.effects.some((e) => e.is(setFocusDim)))
      ) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export const focusDimExtension: Extension = [focusEnabled, dimPlugin];

/** Install `focusDimExtension` in Code view's extension list for this to work. */
export function codeFocus(view: EditorView): FocusSurface {
  return {
    setFocusEnabled(on) {
      view.dispatch({ effects: setFocusDim.of(on) });
    },
  };
}
