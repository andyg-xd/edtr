import { Plugin, type EditorState } from 'prosemirror-state';
import { undoDepth, redoDepth } from 'prosemirror-history';
import { keydownHandler } from 'prosemirror-keymap';
import type { HistoryEdge } from './historyEdge';

/**
 * Both Live views' half of undo across the Code ↔ Live switch: when the
 * editor's own history is used up, ⌘Z / ⇧⌘Z / ⌘Y and the Edit menu's Undo and
 * Redo ask for a whole-view step instead of doing nothing.
 *
 * Must be listed BEFORE `history()` and the ⌘Z keymap, so it sees each event
 * first. Two entry points, because the menu's Undo does not arrive as a key:
 * WebKit turns it into `beforeinput` with `inputType: "historyUndo"`, which
 * `prosemirror-history` handles on its own.
 */
export function pmHistoryEdgePlugin(getEdge: () => HistoryEdge | undefined): Plugin {
  const step = (direction: 'undo' | 'redo', state: EditorState): boolean => {
    const depth = direction === 'undo' ? undoDepth(state) : redoDepth(state);
    return depth === 0 && (getEdge()?.(direction) ?? false);
  };
  const keys = keydownHandler({
    'Mod-z': (state) => step('undo', state),
    'Mod-y': (state) => step('redo', state),
    'Shift-Mod-z': (state) => step('redo', state),
  });

  return new Plugin({
    props: {
      handleKeyDown: keys,
      handleDOMEvents: {
        beforeinput(view, event) {
          const e = event as InputEvent;
          const direction = e.inputType === 'historyUndo' ? 'undo' : e.inputType === 'historyRedo' ? 'redo' : null;
          if (!direction || !step(direction, view.state)) return false;
          e.preventDefault();
          return true;
        },
      },
    },
  });
}
