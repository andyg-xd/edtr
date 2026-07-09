import { open } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from './fileIo';
import { DocumentSession } from './documentSession';

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
