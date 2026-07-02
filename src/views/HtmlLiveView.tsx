import { useEffect, useRef } from 'react';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { htmlSchema } from './htmlSchema';

interface HtmlLiveViewProps {
  doc: PMNode;
  styleText: string;
}

/**
 * Read-only HTML Live view (Phase 4a). Mounts a non-editable ProseMirror view
 * inside a shadow root and injects the file's CSS so the page renders like a
 * browser while staying encapsulated from the app chrome. No editing (4b).
 */
export function HtmlLiveView({ doc, styleText }: HtmlLiveViewProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const shadow = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' });
    // reset any prior content (remount safety)
    shadow.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = styleText;
    shadow.appendChild(style);
    const mount = document.createElement('div');
    shadow.appendChild(mount);
    const view = new EditorView(mount, {
      state: EditorState.create({ doc, schema: htmlSchema }),
      editable: () => false,
    });
    return () => view.destroy();
    // Mount once per doc; the parent supplies a fresh `key` when the file changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="html-live-view" />;
}
