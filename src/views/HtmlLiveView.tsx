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

/**
 * Edit-only fallback so an UNSTYLED table (e.g. one the user just inserted) is
 * visible and clickable in the shadow root, whose only other CSS is the file's
 * own. Injected BEFORE the file style so any author table rules win by source
 * order (these are low-specificity tag selectors). Neutral translucent border
 * reads on any light/dark file background; min-width/padding give empty cells a
 * clickable footprint. Never written back to source (render-only).
 */
const TABLE_EDIT_AFFORDANCE_CSS =
  'table{border-collapse:collapse}' +
  'th,td{border:1px solid rgba(128,128,128,0.4);min-width:2.5em;padding:0.25em 0.5em}';

/**
 * Browser-default reset for the shadow render, injected FIRST (lowest priority)
 * so the file's own CSS wins by source order. It fixes two shadow-root artifacts
 * that made HTML Live unreadable in DARK mode: (1) a synthesized html/body in a
 * shadow root gets no browser "canvas" background, and (2) inherited color /
 * color-scheme leak across the host boundary from Edtr's themed shell — so a
 * light-styled file's dark text sat on a dark inherited context.
 *
 * The white canvas goes on `:host` — the host div IS the file's page/root element
 * because parse rewrites the file's `:root` selectors to `:host` — so a file that
 * themes its page via `:root`/`:host` overrides it by source order, while a file
 * that themes via `body{}`/`html{}` paints over it inside the shadow. Crucially we
 * do NOT force an opaque background on html/body: that would clobber a dark file
 * that themes only `html`/`:root` and leave its light text on forced white. The
 * text-color reset is a low-specificity `html,body` rule so any file `body{}` /
 * `html{}` color wins. (Cascade across the host boundary verified in a browser.)
 */
const SCAFFOLD_DEFAULT_CSS =
  ':host{background-color:#fff;color-scheme:light}html,body{color:#000}';

/** Empty / fully-transparent computed background — treated as "no background". */
function isTransparentColor(c: string): boolean {
  return !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
}

/** Relative luminance < 0.5 ⇒ a dark surface (so we match a dark color-scheme).
 * A fully transparent color is NOT dark — the readability canvas behind it is
 * white — so `rgba(0,0,0,0)` must not be misread as black. */
function isDarkColor(c: string): boolean {
  const m = c.match(/\d+(?:\.\d+)?/g);
  if (!m || m.length < 3) return false;
  const [r, g, b, a] = m.map(Number);
  if (a === 0) return false;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

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
    // Browser-default reset, appended FIRST (before the affordance + file style)
    // so it's the lowest-priority stylesheet and the file's own CSS wins. Both
    // read-only and editable renders need it (the dark-mode bleed-through affects
    // both). See SCAFFOLD_DEFAULT_CSS.
    const defaults = document.createElement('style');
    defaults.setAttribute('data-edtr-defaults', '');
    defaults.textContent = SCAFFOLD_DEFAULT_CSS;
    shadow.appendChild(defaults);
    // Edit-only table affordance, appended before the file's own <style>
    // (appended next) so the file wins the cascade on equal specificity.
    if (editable) {
      const affordance = document.createElement('style');
      affordance.setAttribute('data-edtr-affordance', '');
      affordance.textContent = TABLE_EDIT_AFFORDANCE_CSS;
      shadow.appendChild(affordance);
    }
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

    // Canvas-background propagation. A browser paints the viewport with the
    // root/body background; our shadow scaffold does not, so a dark-themed page
    // rendered as a dark block on the white readability canvas (SCAFFOLD_DEFAULT_
    // CSS). Mirror the page's effective background onto the host (html bg → body
    // bg → the :host default) and match color-scheme, so the whole pane goes dark
    // for a dark page and stays white for a light one. Re-run on OS appearance
    // change — the file's own @media(prefers-color-scheme) re-evaluates live.
    // NOTE: coupled to the OS scheme (= Edtr's default System theme); an explicit
    // Edtr Light/Dark override opposite the OS does not drive the file's @media
    // variants (would require rewriting its media queries — see PLAN.md follow-up).
    const syncCanvas = () => {
      const el = host.current;
      if (!el) return;
      el.style.removeProperty('background-color'); // reset so a stale mirror can't stick
      const htmlBg = getComputedStyle(htmlEl).backgroundColor;
      const bodyBg = getComputedStyle(bodyEl).backgroundColor;
      const propagated = !isTransparentColor(htmlBg)
        ? htmlBg
        : (!isTransparentColor(bodyBg) ? bodyBg : null);
      if (propagated) el.style.setProperty('background-color', propagated);
      el.style.setProperty(
        'color-scheme',
        isDarkColor(getComputedStyle(el).backgroundColor) ? 'dark' : 'light',
      );
    };
    syncCanvas();
    // jsdom has no matchMedia — guard so unit tests still mount; the browser does.
    const schemeMql = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    schemeMql?.addEventListener('change', syncCanvas);

    return () => {
      schemeMql?.removeEventListener('change', syncCanvas);
      onViewReadyRef.current?.(null);
      view.destroy();
    };
    // Mount once per doc; the parent supplies a fresh key when the file changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="html-live-view" />;
}
