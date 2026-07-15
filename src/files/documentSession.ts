import type { EditorFormat, FileMeta, LoadedFile } from './fileTypes';

/**
 * The state of one open document. Framework-agnostic and pure — no React, no
 * Tauri. Dirty = the current buffer differs from the last-saved text.
 */
export class DocumentSession {
  readonly path: string;
  readonly format: EditorFormat;
  private _meta: FileMeta;
  private _savedText: string;
  private currentText: string;
  private _version = 0;

  constructor(loaded: LoadedFile) {
    this.path = loaded.path;
    this.format = loaded.format;
    this._meta = loaded.meta;
    this._savedText = loaded.text;
    this.currentText = loaded.text;
  }

  get meta(): FileMeta {
    return this._meta;
  }

  get text(): string {
    return this.currentText;
  }

  /** The last-saved (or last-loaded/reloaded) text — the baseline `isDirty`
   * compares against, and the baseline a disk change is compared to. */
  get savedText(): string {
    return this._savedText;
  }

  get version(): number {
    return this._version;
  }

  setCurrentText(text: string): void {
    this.currentText = text;
    this._version++;
  }

  markSaved(): void {
    this._savedText = this.currentText;
  }

  isDirty(): boolean {
    return this.currentText !== this._savedText;
  }

  /** Replace the buffer from a fresh on-disk read: text + meta become the new
   * saved baseline (clean), so a later save re-encodes with the file's current
   * EOL/BOM. `path`/`format` are unchanged (same file). */
  reload(loaded: LoadedFile): void {
    this._meta = loaded.meta;
    this._savedText = loaded.text;
    this.currentText = loaded.text;
    this._version++;
  }
}
