import { open } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from './fileIo';
import { DocumentSession } from './documentSession';

/** Show the native open panel; return a fresh session, or null if cancelled. */
export async function openViaDialog(): Promise<DocumentSession | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Text', extensions: ['md', 'markdown', 'html', 'htm', 'txt'] }],
  });
  if (typeof selected !== 'string') return null;
  const loaded = await readFile(selected);
  return new DocumentSession(loaded);
}

/** Persist the session's current text, then mark it clean. */
export async function saveSession(session: DocumentSession): Promise<void> {
  await writeFile(session.path, session.text, session.meta);
  session.markSaved();
}
