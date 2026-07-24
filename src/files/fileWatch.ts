import { invoke } from '@tauri-apps/api/core';

/** Ask the Rust watcher to watch this file's directory (idempotent, ref-counted). */
export async function watchPath(path: string): Promise<void> {
  await invoke('watch_path', { path });
}

/** Release one watch reference for this file. */
export async function unwatchPath(path: string): Promise<void> {
  await invoke('unwatch_path', { path });
}

/** True if the Rust file watcher initialized (else external-change detection is off). */
export async function watcherAvailable(): Promise<boolean> {
  return invoke<boolean>('watcher_available');
}
