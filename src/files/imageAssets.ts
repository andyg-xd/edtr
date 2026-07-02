import { invoke, convertFileSrc } from '@tauri-apps/api/core';

/** Extensions we treat as insertable images (picker filter + drop/paste guards). */
export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] as const;

/** Schemes that are already WebView-loadable and must not be path-resolved. */
const REMOTE = /^(https?:|data:|blob:|asset:|tauri:|file:)/i;

/** POSIX dirname for an absolute document path. */
export function dirName(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

/** Resolve a possibly-relative `src` against the document's folder → absolute
 *  POSIX path, collapsing '.' and '..'. An already-absolute src passes through. */
export function resolveAgainstDoc(src: string, docPath: string): string {
  if (src.startsWith('/')) return src;
  const parts = dirName(docPath).split('/');
  for (const seg of src.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length > 1) parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/') || '/';
}

/** WebView-loadable URL for an image src: remote/data/etc. pass through; a
 *  local relative/absolute path → convertFileSrc(resolved). Null docPath → src. */
export function resolveImageDisplaySrc(src: string, docPath: string | null): string {
  if (!src || REMOTE.test(src)) return src;
  if (!docPath) return src;
  return convertFileSrc(resolveAgainstDoc(src, docPath));
}

/** Copy an existing file into <doc>.assets/; resolves to the doc-relative path. */
export function copyImageIntoAssets(docPath: string, sourcePath: string): Promise<string> {
  return invoke<string>('copy_image_into_assets', { docPath, sourcePath });
}

/** Write raw image bytes into <doc>.assets/; resolves to the doc-relative path. */
export function writeImageIntoAssets(docPath: string, bytes: number[], ext: string): Promise<string> {
  return invoke<string>('write_image_into_assets', { docPath, bytes, ext });
}
