import { basename } from '../files/fileTypes';

/**
 * The exported document's title, and the stem of the name the save panel
 * offers (6c-iii, Task 7): the file's own name without its extension.
 *
 * Two cases the naive `replace(/\.[^.]+$/, '')` gets wrong:
 *   - a dotfile (`.gitignore`) strips to the EMPTY string, which would title
 *     the export "" and default the panel to a bare ".html";
 *   - an unsaved document has no name at all.
 * Both fall back rather than producing a nameless file.
 */
export function exportTitle(path: string | null): string {
  if (!path) return 'Untitled';
  const name = basename(path);
  const stem = name.replace(/\.[^.]+$/, '');
  return stem.length > 0 ? stem : name;
}
