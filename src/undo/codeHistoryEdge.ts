import { Prec, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { undoDepth, redoDepth } from '@codemirror/commands';
import type { HistoryEdge } from './historyEdge';

/**
 * Code view's twin of `pmHistoryEdgePlugin`: when CodeMirror's own history is
 * used up, ⌘Z / ⇧⌘Z / ⌘Y and the Edit menu's Undo and Redo ask for a
 * whole-view step instead of doing nothing.
 *
 * Highest precedence so it runs ahead of `historyKeymap` and of the history
 * extension's own `beforeinput` handler, which is how the menu's Undo arrives.
 */
export function codeHistoryEdge(getEdge: () => HistoryEdge | undefined): Extension {
  const step = (direction: 'undo' | 'redo', state: EditorState): boolean => {
    const depth = direction === 'undo' ? undoDepth(state) : redoDepth(state);
    return depth === 0 && (getEdge()?.(direction) ?? false);
  };

  return Prec.highest([
    keymap.of([
      { key: 'Mod-z', run: (v) => step('undo', v.state), preventDefault: true },
      { key: 'Mod-y', run: (v) => step('redo', v.state), preventDefault: true },
      { key: 'Mod-Shift-z', run: (v) => step('redo', v.state), preventDefault: true },
    ]),
    EditorView.domEventHandlers({
      beforeinput(event, view) {
        const direction = event.inputType === 'historyUndo' ? 'undo' : event.inputType === 'historyRedo' ? 'redo' : null;
        if (!direction || !step(direction, view.state)) return false;
        event.preventDefault();
        return true;
      },
    }),
  ]);
}
