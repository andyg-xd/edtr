import type { EditorFormat } from '../files/fileTypes';

const FORMAT_LABELS: Record<EditorFormat, string> = {
  markdown: 'Markdown',
  html: 'HTML',
  plaintext: 'Text',
};

interface StatusBarProps {
  format: EditorFormat;
  /**
   * 1-based caret line/column. Pass both, or neither — never a guess. A view
   * that can't report a real position (see DocumentView) omits these so the
   * bar shows the format alone, rather than a stale "Ln 1, Col 1" that never
   * updates.
   */
  line?: number;
  column?: number;
  /**
   * Words and characters for the document, or for the selection when there is
   * one. Pass both or neither — same rule as line/column above: a view that
   * cannot report a real count omits them rather than showing a stale zero.
   */
  words?: number;
  characters?: number;
}

/**
 * Bottom-of-canvas status bar: `[format] [Ln n, Col n] ……… [words · characters]`.
 * Purely presentational; every view decides for itself whether it has a real
 * position or count to report (DocumentView).
 */
export function StatusBar({ format, line, column, words, characters }: StatusBarProps) {
  const hasPosition = line !== undefined && column !== undefined;
  const hasCounts = words !== undefined && characters !== undefined;
  return (
    <div className="status-bar">
      <span className="status-bar-format">{FORMAT_LABELS[format]}</span>
      {hasPosition && (
        <span className="status-bar-position">Ln {line}, Col {column}</span>
      )}
      <span className="status-bar-counts">
        {hasCounts && `${words!.toLocaleString()} words · ${characters!.toLocaleString()} characters`}
      </span>
    </div>
  );
}
