import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { readFile, writeFile } from './fileIo';
import { DocumentSession } from './documentSession';
import type { FolderEntry } from './folder';
import type { OpenPayload } from './openPayload';

/** Show the native open panel (multi-select); return the chosen file paths
 * (empty array if cancelled). */
export async function pickFiles(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    directory: false,
    filters: [{ name: 'Text', extensions: ['md', 'markdown', 'html', 'htm', 'txt'] }],
  });
  if (selected == null) return [];
  return Array.isArray(selected) ? selected : [selected];
}

/** Spawn a new window that will load `payload` on mount. */
export async function openInNewWindow(payload: OpenPayload): Promise<void> {
  await invoke('open_in_new_window', { payload });
}

/** Claim this window's pending open payload (set when it was spawned), if any. */
export async function takePendingOpen(): Promise<OpenPayload | null> {
  return (await invoke<OpenPayload | null>('take_pending_open')) ?? null;
}

/** Claim a cold-launch payload (first window on mount), if any. */
export async function takeLaunchOpen(): Promise<OpenPayload | null> {
  return (await invoke<OpenPayload | null>('take_launch_open')) ?? null;
}

/** Tell Rust this window's listeners are live (so OS opens push, not stash). */
export async function markFrontendReady(): Promise<void> {
  await invoke('mark_frontend_ready');
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
