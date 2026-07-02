import { useEffect, useRef } from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { baseKeymap } from 'prosemirror-commands';
import { liveSchema } from './liveSchema';
import { dirtyTrackingPlugin, getDirtyBlockIds } from './dirtyTracking';
import { toggleStrong, toggleEm } from '../commands/markdownInlineCommands';
import { blockIdentityPlugin } from './blockIdentity';
import { splitCommand, softBreakCommand } from '../commands/markdownStructureCommands';
import { goToNextCell, arrowVertical } from '../commands/markdownTableCommands';
import { writeImageIntoAssets, resolveImageDisplaySrc } from '../files/imageAssets';
import { insertImage } from '../commands/markdownInlineCommands';

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
  /** Absolute path of the document being edited; enables pasted-image insertion into <doc>.assets/. */
  docPath?: string | null;
  /** Surface a non-destructive error to the consumer (e.g. a pasted-image write failure). */
  onError?: (msg: string) => void;
}

export function LiveView({
  doc,
  editable = true,
  onEdit,
  onViewReady,
  onStateChange,
  onLinkShortcut,
  docPath = null,
  onError,
}: LiveViewProps) {
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
          keymap({ Enter: splitCommand, 'Shift-Enter': softBreakCommand }),
          keymap({ Tab: goToNextCell(1), 'Shift-Tab': goToNextCell(-1) }),
          keymap({ ArrowUp: arrowVertical('up'), ArrowDown: arrowVertical('down') }),
          keymap({
            'Mod-b': toggleStrong,
            'Mod-i': toggleEm,
            'Mod-k': linkShortcut,
            'Mod-z': undo,
            'Mod-y': redo,
            'Shift-Mod-z': redo,
          }),
          keymap(baseKeymap),
          blockIdentityPlugin(),
          dirtyTrackingPlugin(),
        ]
      : [];
    const view = new EditorView(host.current, {
      state: EditorState.create({ doc, schema: liveSchema, plugins }),
      editable: () => editable,
      handlePaste: (view, event) => {
        if (!docPath) return false;
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (!file) continue;
            const ext = (item.type.split('/')[1] || 'png').split('+')[0]; // image/svg+xml -> svg
            file.arrayBuffer()
              .then((buf) => writeImageIntoAssets(docPath, Array.from(new Uint8Array(buf)), ext))
              .then((rel) => {
                if (view.isDestroyed) return; // Live view was torn down mid-write — don't touch a destroyed view
                const display = resolveImageDisplaySrc(rel, docPath);
                insertImage(rel, null, null, display)(view.state, view.dispatch);
              })
              .catch((err) => {
                onError?.(`Edtr couldn't paste that image. ${String(err)}`);
              });
            return true; // consume the paste (image handled asynchronously)
          }
        }
        return false; // not an image → default paste
      },
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
