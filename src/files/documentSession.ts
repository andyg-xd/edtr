import { formatForPath, type EditorFormat, type FileMeta, type LoadedFile } from './fileTypes';

/**
 * The state of one open document. Framework-agnostic and pure — no React, no
 * Tauri. Dirty = the current buffer differs from the last-saved text.
 */
export class DocumentSession {
  private _path: string;
  private _format: EditorFormat;
  private _meta: FileMeta;
  private _savedText: string;
  private currentText: string;
  private _version = 0;

  constructor(loaded: LoadedFile) {
    this._path = loaded.path;
    this._format = loaded.format;
    this._meta = loaded.meta;
    this._savedText = loaded.text;
    this.currentText = loaded.text;
  }

  get path(): string {
    return this._path;
  }

  get format(): EditorFormat {
    return this._format;
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

  /** Rebind this session to a new path (Save As): the buffer becomes the
   * saved baseline AT the new path (clean), and format re-derives from the new
   * extension. `meta` (EOL/BOM) is unchanged — the bytes we just wrote used it. */
  rebind(newPath: string): void {
    this._path = newPath;
    this._format = formatForPath(newPath);
    this._savedText = this.currentText;
    this._version++;
  }
}
