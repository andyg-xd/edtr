import { useEffect, useRef } from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { liveSchema } from './liveSchema';

interface LiveViewProps {
  doc: PMNode;
}

/**
 * Mounts a read-only ProseMirror EditorView rendering the projected doc.
 * Read-only in 3a (editable: () => false); editing arrives in 3b. The parent
 * remounts via `key` when the document changes.
 */
export function LiveView({ doc }: LiveViewProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView(host.current, {
      state: EditorState.create({ doc, schema: liveSchema }),
      editable: () => false,
    });
    return () => view.destroy();
    // Mount once per doc; the parent supplies a fresh key when the doc changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="live-view" />;
}
