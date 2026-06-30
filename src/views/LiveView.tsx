import { useEffect, useRef } from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, Plugin, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { baseKeymap, chainCommands, newlineInCode } from 'prosemirror-commands';
import { liveSchema } from './liveSchema';
import { dirtyTrackingPlugin, getDirtyBlockIds } from './dirtyTracking';
import { toggleStrong, toggleEm } from '../commands/markdownInlineCommands';

interface LiveViewProps {
  doc: PMNode;
  /**
   * Whether the editor is editable. Mount-only — changing this prop after mount
   * has no effect. To toggle editability, remount via a new React `key`.
   */
  editable?: boolean;
  onEdit?: (doc: PMNode, dirtyIds: Set<string>) => void;
  /** Reports the EditorView on mount, and null on unmount. */
  onViewReady?: (view: EditorView | null) => void;
  /** Fires on every transaction (incl. selection-only) so a ribbon can re-render. */
  onStateChange?: (view: EditorView) => void;
  /** Called by ⌘K so the consumer can open the link popover. */
  onLinkShortcut?: () => void;
}

/**
 * Rejects any transaction that changes the top-level block sequence (count,
 * type, or identity/order). Content edits within a block are allowed.
 * Structural editing arrives with the 3c ribbon.
 */
export function structureLockPlugin(): Plugin {
  return new Plugin({
    filterTransaction(tr, state) {
      if (!tr.docChanged) return true;
      const before = state.doc;
      const after = tr.doc;
      if (before.childCount !== after.childCount) return false;
      for (let i = 0; i < before.childCount; i++) {
        const b = before.child(i);
        const a = after.child(i);
        if (b.type !== a.type || b.attrs.blockId !== a.attrs.blockId) return false;
      }
      return true;
    },
  });
}

// Enter inserts a within-block hard break (a newline in code blocks); it never
// splits a block (structure is locked in 3b).
const insertHardBreak: Command = (state, dispatch) => {
  const br = liveSchema.nodes.hardBreak.create();
  if (dispatch) dispatch(state.tr.replaceSelectionWith(br).scrollIntoView());
  return true;
};
const enterCommand = chainCommands(newlineInCode, insertHardBreak);

export function LiveView({ doc, editable = true, onEdit, onViewReady, onStateChange, onLinkShortcut }: LiveViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;
  const onViewReadyRef = useRef(onViewReady);
  onViewReadyRef.current = onViewReady;
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  const onLinkShortcutRef = useRef(onLinkShortcut);
  onLinkShortcutRef.current = onLinkShortcut;

  useEffect(() => {
    if (!host.current) return;
    const linkShortcut: Command = () => { onLinkShortcutRef.current?.(); return true; };
    const plugins = editable
      ? [
          history(),
          keymap({ Enter: enterCommand, 'Shift-Enter': enterCommand }),
          keymap({
            'Mod-b': toggleStrong,
            'Mod-i': toggleEm,
            'Mod-k': linkShortcut,
            'Mod-z': undo,
            'Mod-y': redo,
            'Shift-Mod-z': redo,
          }),
          keymap(baseKeymap),
          structureLockPlugin(),
          dirtyTrackingPlugin(),
        ]
      : [];
    const view = new EditorView(host.current, {
      state: EditorState.create({ doc, schema: liveSchema, plugins }),
      editable: () => editable,
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged && onEditRef.current) {
          onEditRef.current(next.doc, getDirtyBlockIds(next));
        }
        onStateChangeRef.current?.(view);
      },
    });
    onViewReadyRef.current?.(view);
    return () => {
      onViewReadyRef.current?.(null);
      view.destroy();
    };
    // Mount once per doc; the parent supplies a fresh key when the doc changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="live-view" />;
}
