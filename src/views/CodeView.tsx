import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { buildCodeViewExtensions } from './codeViewExtensions';
import type { EditorFormat } from '../files/fileTypes';

interface CodeViewProps {
  initialText: string;
  format: EditorFormat;
  onChange: (text: string) => void;
}

/**
 * Mounts a CodeMirror EditorView once. The editor is uncontrolled after mount
 * (CodeMirror owns the buffer); the parent remounts via `key` when the file
 * changes. Edits are pushed up through `onChange`.
 */
export function CodeView({ initialText, format, onChange }: CodeViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          ...buildCodeViewExtensions(format),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view.destroy();
    // Mount once per file; the parent supplies a fresh `key` per opened file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="code-view" />;
}
