import type { EditorFormat, FileMeta, LoadedFile } from './fileTypes';

/**
 * The state of one open document. Framework-agnostic and pure — no React, no
 * Tauri. Dirty = the current buffer differs from the last-saved text.
 */
export class DocumentSession {
  readonly path: string;
  readonly format: EditorFormat;
  readonly meta: FileMeta;
  private savedText: string;
  private currentText: string;

  constructor(loaded: LoadedFile) {
    this.path = loaded.path;
    this.format = loaded.format;
    this.meta = loaded.meta;
    this.savedText = loaded.text;
    this.currentText = loaded.text;
  }

  get text(): string {
    return this.currentText;
  }

  setCurrentText(text: string): void {
    this.currentText = text;
  }

  markSaved(): void {
    this.savedText = this.currentText;
  }

  isDirty(): boolean {
    return this.currentText !== this.savedText;
  }
}
