import { useEffect, useRef } from 'react';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { htmlSchema } from './htmlSchema';
import { safeAttrs } from './htmlSanitize';

interface HtmlLiveViewProps {
  doc: PMNode;
  styleText: string;
  bodyAttrs?: Record<string, string>;
  rootAttrs?: Record<string, string>;
}

/**
 * Read-only HTML Live view (Phase 4a). Mounts a non-editable ProseMirror view
 * inside a shadow root and injects the file's CSS so the page renders like a
 * browser while staying encapsulated from the app chrome. No editing (4b).
 *
 * The shadow tree reconstructs an <html>/<body> scaffold (with the source's
 * own attributes, sanitized) so body/html/:root-scoped CSS — page colors,
 * container borders, custom properties defined on body/html — actually
 * matches something and applies, instead of being silently dropped.
 */
export function HtmlLiveView({ doc, styleText, bodyAttrs = {}, rootAttrs = {} }: HtmlLiveViewProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const shadow = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' });
    // reset any prior content (remount safety)
    shadow.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = styleText;
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

    const view = new EditorView(bodyEl, {
      state: EditorState.create({ doc, schema: htmlSchema }),
      editable: () => false,
    });
    return () => view.destroy();
    // Mount once per doc; the parent supplies a fresh `key` when the file changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="html-live-view" />;
}
