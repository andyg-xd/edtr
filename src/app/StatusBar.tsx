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
}

/**
 * Bottom-of-canvas status bar: `[format] [Ln n, Col n] ……… [counts slot]`.
 * The counts slot is deliberately empty here — 6c-ii fills it with word count.
 * Purely presentational; every view decides for itself whether it has a real
 * position to report (DocumentView).
 */
export function StatusBar({ format, line, column }: StatusBarProps) {
  const hasPosition = line !== undefined && column !== undefined;
  return (
    <div className="status-bar">
      <span className="status-bar-format">{FORMAT_LABELS[format]}</span>
      {hasPosition && (
        <span className="status-bar-position">Ln {line}, Col {column}</span>
      )}
      <span className="status-bar-counts" />
    </div>
  );
}
