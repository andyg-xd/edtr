import { open, save } from '@tauri-apps/plugin-dialog';
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

/** Show every file of `payload` that another window already has, in that
 * window; return what is left to open here, or null if nothing is. */
export async function routeOpenPayload(payload: OpenPayload): Promise<OpenPayload | null> {
  return (await invoke<OpenPayload | null>('route_open_payload', { payload })) ?? null;
}

/** Tell Rust this window has `path` open, so no other window opens it again. */
export async function registerOpenPath(path: string): Promise<void> {
  await invoke('register_open_path', { path });
}

/** Release this window's claim on `path`. */
export async function releaseOpenPath(path: string): Promise<void> {
  await invoke('release_open_path', { path });
}

/** Claim this window's pending open payload (set when it was spawned), if any. */
export async function takePendingOpen(): Promise<OpenPayload | null> {
  return (await invoke<OpenPayload | null>('take_pending_open')) ?? null;
}

/** Claim a cold-launch payload (first window on mount), if any. */
export async function takeLaunchOpen(): Promise<OpenPayload | null> {
  return (await invoke<OpenPayload | null>('take_launch_open')) ?? null;
}

/** Tell Rust this window's listeners are live (so OS opens push, not stash).
 * Returns a cold-launch payload that was stashed during the mount→ready
 * window and stranded (the mount claim already ran and found nothing). */
export async function markFrontendReady(): Promise<OpenPayload | null> {
  return (await invoke<OpenPayload | null>('mark_frontend_ready')) ?? null;
}

/** Persist the session's current text, then mark it clean. Returns false, having
 * written nothing, when the person declines to overwrite.
 *
 * The file is re-read first: if it no longer holds what this session last
 * loaded or saved, another app or window wrote it, and saving would destroy
 * that work unseen — the reload banner alone could not prevent it, since it is
 * shown only for the active document and can be dismissed. A file that cannot
 * be read is written as before: a deleted one has nothing to lose, and an
 * unreadable one fails at the write with its own error. */
export async function saveSession(
  session: DocumentSession,
  confirmOverwrite: (path: string) => Promise<boolean>,
): Promise<boolean> {
  const onDisk = await readFile(session.path).then((f) => f.text, () => null);
  if (onDisk !== null && onDisk !== session.savedText && !(await confirmOverwrite(session.path))) {
    return false;
  }
  await writeFile(session.path, session.text, session.meta);
  session.markSaved();
  return true;
}

/** Show the native folder picker; return the chosen folder path, or null if cancelled. */
export async function pickFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === 'string' ? selected : null;
}

/** Show the native save panel; return the chosen path, or null if cancelled. */
export async function pickSavePath(defaultName: string): Promise<string | null> {
  const selected = await save({
    defaultPath: defaultName,
    filters: [{ name: 'Text', extensions: ['md', 'markdown', 'html', 'htm', 'txt'] }],
  });
  return selected ?? null;
}

/** List a folder's editable files (flat, sorted) via the Rust command. */
export async function readFolder(path: string): Promise<FolderEntry[]> {
  return invoke<FolderEntry[]>('read_folder', { path });
}

/** Read a file from disk and wrap it in a fresh editing session. */
export async function readSession(path: string): Promise<DocumentSession> {
  return new DocumentSession(await readFile(path));
}
