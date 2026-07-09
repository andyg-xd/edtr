import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { readFile, writeFile } from './fileIo';
import { DocumentSession } from './documentSession';
import type { FolderEntry } from './folder';

/** Show the native open panel (multi-select); return a session per chosen file
 * (empty array if cancelled). */
export async function openViaDialog(): Promise<DocumentSession[]> {
  const selected = await open({
    multiple: true,
    directory: false,
    filters: [{ name: 'Text', extensions: ['md', 'markdown', 'html', 'htm', 'txt'] }],
  });
  if (selected == null) return [];
  const paths = Array.isArray(selected) ? selected : [selected];
  const sessions: DocumentSession[] = [];
  for (const path of paths) {
    const loaded = await readFile(path);
    sessions.push(new DocumentSession(loaded));
  }
  return sessions;
}

/** Persist the session's current text, then mark it clean. */
export async function saveSession(session: DocumentSession): Promise<void> {
  await writeFile(session.path, session.text, session.meta);
  session.markSaved();
}

/** Show the native folder picker; return the chosen folder path, or null if cancelled. */
export async function pickFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === 'string' ? selected : null;
}

/** List a folder's editable files (flat, sorted) via the Rust command. */
export async function readFolder(path: string): Promise<FolderEntry[]> {
  return invoke<FolderEntry[]>('read_folder', { path });
}

/** Read a file from disk and wrap it in a fresh editing session. */
export async function readSession(path: string): Promise<DocumentSession> {
  return new DocumentSession(await readFile(path));
}
