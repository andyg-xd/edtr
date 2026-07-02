import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { buildCodeViewExtensions, themeCompartment, themeExtensionFor } from './codeViewExtensions';
import type { EditorFormat } from '../files/fileTypes';
import type { EffectiveTheme } from '../settings/theme';

interface CodeViewProps {
  initialText: string;
  format: EditorFormat;
  effectiveTheme: EffectiveTheme;
  onChange: (text: string) => void;
}

/**
 * Mounts a CodeMirror EditorView once. The editor is uncontrolled after mount
 * (CodeMirror owns the buffer); the parent remounts via `key` when the file
 * changes. Edits are pushed up through `onChange`. The theme is swapped in
 * place via themeCompartment.reconfigure when `effectiveTheme` changes — no
 * remount, so cursor/selection/history survive a theme toggle.
 */
export function CodeView({ initialText, format, effectiveTheme, onChange }: CodeViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Read the latest theme inside the mount-once effect without re-running it.
  const themeRef = useRef(effectiveTheme);
  themeRef.current = effectiveTheme;

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          ...buildCodeViewExtensions(format, themeRef.current),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once per file; the parent supplies a fresh `key` per opened file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the theme in place when it changes (no remount).
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.reconfigure(themeExtensionFor(effectiveTheme)),
    });
  }, [effectiveTheme]);

  return <div ref={host} className="code-view" />;
}
