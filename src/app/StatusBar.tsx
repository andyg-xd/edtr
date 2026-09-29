import type { EditorFormat } from '../files/fileTypes';
import type { LinkHint } from '../links/useLinkHint';

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
  /**
   * True when `words`/`characters` describe the SELECTION rather than the whole
   * document (6c-ii-b, F6).
   *
   * Without it the same pair of numbers means two different things and the bar
   * changes between them silently — the reader sees the figure drop and has no
   * way to tell a selection from a shorter document.
   */
  isSelection?: boolean;
  /**
   * The link under the pointer in a Live view, if any: its address and what a
   * ⌘-click will do, the way a browser shows a hovered link's address.
   */
  linkHint?: LinkHint;
}

/**
 * Bottom-of-canvas status bar: `[format] [Ln n, Col n] ……… [words · characters]`,
 * or `Selected: N words · M characters` while something is selected.
 * Purely presentational; every view decides for itself whether it has a real
 * position or count to report (DocumentView).
 */
export function StatusBar({ format, line, column, words, characters, isSelection, linkHint }: StatusBarProps) {
  const hasPosition = line !== undefined && column !== undefined;
  const hasCounts = words !== undefined && characters !== undefined;
  return (
    <div className="status-bar">
      <span className="status-bar-format">{FORMAT_LABELS[format]}</span>
      {hasPosition && (
        <span className="status-bar-position">Ln {line}, Col {column}</span>
      )}
      {linkHint !== undefined && (
        <span className={`status-bar-link${linkHint.openable ? ' is-openable' : ''}`}>
          <span className="status-bar-link-url">{linkHint.url}</span> · {linkHint.action}
        </span>
      )}
      <span className="status-bar-counts">
        {hasCounts && `${isSelection ? 'Selected: ' : ''}${words!.toLocaleString()} words · ${characters!.toLocaleString()} characters`}
      </span>
    </div>
  );
}
