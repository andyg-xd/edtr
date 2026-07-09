/** What a freshly-opened window loads. Mirrors the Rust `OpenPayload` enum
 * (serde tag "kind"): a set of files, or a folder to list. */
export type OpenPayload =
  | { kind: 'files'; paths: string[] }
  | { kind: 'folder'; path: string };

/** A window is "empty" (safe to fill in place rather than spawn a new window)
 * when it holds no open documents and no folder context. */
export function isEmptyWindow(docCount: number, hasFolder: boolean): boolean {
  return docCount === 0 && !hasFolder;
}
