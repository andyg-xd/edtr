import { IMAGE_EXTS } from './imageAssets';

/** Document types Edtr auto-opens (matches bundle.fileAssociations, D4/D5).
 * NOT `.txt` — that opens only via the explicit ⌘O dialog. */
export const DOCUMENT_EXTS = ['md', 'markdown', 'html', 'htm'] as const;

/** Classify a dropped/opened path by extension, to decide how to handle it:
 * a document is opened in a window, an image is inserted at the cursor. */
export function classifyPath(path: string): 'document' | 'image' | 'other' {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  if (path.includes('.') && (DOCUMENT_EXTS as readonly string[]).includes(ext)) return 'document';
  if (path.includes('.') && (IMAGE_EXTS as readonly string[]).includes(ext)) return 'image';
  return 'other';
}
