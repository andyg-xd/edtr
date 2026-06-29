import { invoke } from '@tauri-apps/api/core';
import { formatForPath, type FileMeta, type LoadedFile } from './fileTypes';

interface RawLoaded {
  text: string;
  meta: FileMeta;
}

/** Read a file via the Rust command; attach the editor format from its path. */
export async function readFile(path: string): Promise<LoadedFile> {
  const raw = await invoke<RawLoaded>('read_text_file', { path });
  return { path, text: raw.text, meta: raw.meta, format: formatForPath(path) };
}

/** Atomically write a file via the Rust command, re-applying its byte conventions. */
export async function writeFile(path: string, text: string, meta: FileMeta): Promise<void> {
  await invoke('write_text_file_atomic', { path, text, meta });
}
