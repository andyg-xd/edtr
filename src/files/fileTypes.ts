export type Eol = 'lf' | 'crlf';

/** Everything needed to reproduce the original file bytes on save. */
export interface FileMeta {
  eol: Eol;
  hadBom: boolean;
}

export type EditorFormat = 'markdown' | 'html' | 'plaintext';

/** A file loaded from disk, normalized to `\n` line endings. */
export interface LoadedFile {
  path: string;
  text: string;
  meta: FileMeta;
  format: EditorFormat;
}

/** Pick the editor language from a file path's extension. */
export function formatForPath(path: string): EditorFormat {
  const dot = path.lastIndexOf('.');
  const ext = dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'html' || ext === 'htm') return 'html';
  return 'plaintext';
}

/** The final path segment (handles both `/` separators). */
export function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}
