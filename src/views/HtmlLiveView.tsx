import { useEffect, useRef } from 'react';
import { EditorState, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { baseKeymap } from 'prosemirror-commands';
import type { Node as PMNode } from 'prosemirror-model';
import { htmlSchema } from './htmlSchema';
import { safeAttrs } from './htmlSanitize';
import { dirtyTrackingPlugin, getDirtyBlockIds } from './dirtyTracking';
import { blockIdentityPlugin } from './blockIdentity';
import { splitCommand, softBreakCommand } from '../commands/htmlStructureCommands';
import { sinkListItemCmd, liftListItemCmd } from '../commands/htmlBlockCommands';
import { goToNextCell, arrowVertical } from '../commands/htmlTableCommands';
import {
  toggleStrong, toggleEm, toggleUnderline, insertImage,
} from '../commands/htmlInlineCommands';
import { writeImageIntoAssets, resolveImageDisplaySrc } from '../files/imageAssets';

interface HtmlLiveViewProps {
  doc: PMNode;
  styleText: string;
  bodyAttrs?: Record<string, string>;
  rootAttrs?: Record<string, string>;
  editable?: boolean;
  docPath?: string | null;
  onEdit?: (doc: PMNode, dirtyIds: Set<string>) => void;
  onViewReady?: (view: EditorView | null) => void;
  onStateChange?: (view: EditorView) => void;
  onLinkShortcut?: () => void;
  /** Surface a non-destructive error to the consumer (e.g. a pasted-image write failure). */
  onError?: (message: string) => void;
}

/**
 * HTML Live view. Read-only (4a) or editable (4b/4d). Mounts a ProseMirror
 * view inside a shadow root and injects the file's CSS (`:root`→`:host`) plus
 * an <html>/<body> scaffold so document-scoped CSS applies. When editable,
 * wires history + mark shortcuts + Enter→split / Shift-Enter→soft-break +
 * Tab/Shift-Tab list indent/outdent (4d-ii; falls through outside a list) +
 * block-identity tracking (structural editing, 4d) + dirty tracking; edits
 * are reported via onEdit (no write-back happens here).
 */
export function HtmlLiveView({
  doc, styleText, bodyAttrs = {}, rootAttrs = {},
  editable = false, docPath = null, onEdit, onViewReady, onStateChange, onLinkShortcut, onError,
}: HtmlLiveViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const onEditRef = useRef(onEdit); onEditRef.current = onEdit;
  const onViewReadyRef = useRef(onViewReady); onViewReadyRef.current = onViewReady;
  const onStateChangeRef = useRef(onStateChange); onStateChangeRef.current = onStateChange;
  const onLinkShortcutRef = useRef(onLinkShortcut); onLinkShortcutRef.current = onLinkShortcut;
  const docPathRef = useRef(docPath); docPathRef.current = docPath;
  const onErrorRef = useRef(onError); onErrorRef.current = onError;

  useEffect(() => {
    if (!host.current) return;
    const shadow = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' });
    shadow.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = styleText.replace(/:root\b/g, ':host');
    shadow.appendChild(style);

    const applyAttrs = (el: Element, attrs: Record<string, string>) => {
      for (const [k, v] of Object.entries(safeAttrs(attrs))) {
        try { el.setAttribute(k, v); } catch { /* invalid attr name — skip */ }
      }
    };
    const htmlEl = document.createElement('html');
    applyAttrs(htmlEl, rootAttrs);
    const bodyEl = document.createElement('body');
    applyAttrs(bodyEl, bodyAttrs);
    htmlEl.appendChild(bodyEl);
    shadow.appendChild(htmlEl);

    const linkShortcut: Command = () => { onLinkShortcutRef.current?.(); return true; };
    const plugins = editable
      ? [
          history(),
          keymap({
            Enter: splitCommand,
            'Shift-Enter': softBreakCommand,
            Tab: sinkListItemCmd,
            'Shift-Tab': liftListItemCmd,
          }),
          // Table grid nav. Ordered AFTER the list keymap so list indent still
          // works inside a cell that holds a list; goToNextCell returns false
          // outside a table, so Tab falls through to normal handling.
          keymap({ Tab: goToNextCell(1), 'Shift-Tab': goToNextCell(-1) }),
          keymap({ ArrowUp: arrowVertical('up'), ArrowDown: arrowVertical('down') }),
          keymap({
            'Mod-b': toggleStrong, 'Mod-i': toggleEm, 'Mod-u': toggleUnderline,
            'Mod-k': linkShortcut, 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo,
          }),
          keymap(baseKeymap),
          blockIdentityPlugin(),
          dirtyTrackingPlugin(),
        ]
      : [];

    const view = new EditorView(bodyEl, {
      state: EditorState.create({ doc, schema: htmlSchema, plugins }),
      editable: () => editable,
      handlePaste: (view, event) => {
        if (!editable || !docPathRef.current) return false;
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (!file) continue;
            const dp = docPathRef.current;
            const ext = (item.type.split('/')[1] || 'png').split('+')[0]; // image/svg+xml -> svg
            file.arrayBuffer()
              .then((buf) => writeImageIntoAssets(dp, Array.from(new Uint8Array(buf)), ext))
              .then((rel) => {
                if (view.isDestroyed) return;
                const display = resolveImageDisplaySrc(rel, dp);
                insertImage(rel, null, display)(view.state, view.dispatch);
              })
              .catch((err) => {
                onErrorRef.current?.(`Edtr couldn't paste that image. ${String(err)}`);
              });
            return true;
          }
        }
        return false;
      },
      dispatchTransaction(tr) {
        const prev = view.state;
        const next = prev.apply(tr);
        view.updateState(next);
        // `apply` can return the exact same state object for a transaction
        // that produces no real change (e.g. one rejected by a plugin's
        // filterTransaction, or a genuine no-op) — gate on state identity so
        // onEdit only fires when the state actually changed.
        if (next !== prev && onEditRef.current) onEditRef.current(next.doc, getDirtyBlockIds(next));
        onStateChangeRef.current?.(view);
      },
    });
    onViewReadyRef.current?.(view);
    return () => { onViewReadyRef.current?.(null); view.destroy(); };
    // Mount once per doc; the parent supplies a fresh key when the file changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="html-live-view" />;
}
