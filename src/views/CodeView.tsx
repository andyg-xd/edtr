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
  /**
   * Fires with the caret's 1-based line/column on mount, and again after every
   * transaction that moves the caret or changes the doc (status bar, 6d-ii).
   */
  onCursorChange?: (line: number, column: number) => void;
  /** Reports the EditorView on mount, and null on unmount — lets the parent drive find. */
  onViewReady?: (view: EditorView | null) => void;
}

/**
 * Mounts a CodeMirror EditorView once. The editor is uncontrolled after mount
 * (CodeMirror owns the buffer); the parent remounts via `key` when the file
 * changes. Edits are pushed up through `onChange`. The theme is swapped in
 * place via themeCompartment.reconfigure when `effectiveTheme` changes — no
 * remount, so cursor/selection/history survive a theme toggle.
 */
export function CodeView({ initialText, format, effectiveTheme, onChange, onCursorChange, onViewReady }: CodeViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;
  const onViewReadyRef = useRef(onViewReady);
  onViewReadyRef.current = onViewReady;
  // Read the latest theme inside the mount-once effect without re-running it.
  const themeRef = useRef(effectiveTheme);
  themeRef.current = effectiveTheme;

  useEffect(() => {
    if (!host.current) return;
    const reportCursor = (state: EditorState) => {
      if (!onCursorChangeRef.current) return;
      const pos = state.selection.main.head;
      const line = state.doc.lineAt(pos);
      onCursorChangeRef.current(line.number, pos - line.from + 1);
    };
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          ...buildCodeViewExtensions(format, themeRef.current),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
            if (u.docChanged || u.selectionSet) reportCursor(u.state);
          }),
        ],
      }),
    });
    viewRef.current = view;
    reportCursor(view.state); // initial caret position (Ln 1, Col 1 on a fresh doc)
    onViewReadyRef.current?.(view);
    return () => {
      onViewReadyRef.current?.(null);
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
