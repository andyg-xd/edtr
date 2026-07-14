import { invoke } from '@tauri-apps/api/core';

/** Mirrors the Rust `RecentEntry` (serde tag). */
export type RecentEntry = { kind: 'file' | 'folder'; path: string };

/** Record a just-opened file/folder in the persistent Recents list (Rust
 * persists it + rebuilds the native "Open Recent" menu). Fire-and-forget:
 * a failure to record must never break an open. */
export async function recordRecent(entry: RecentEntry): Promise<void> {
  await invoke('record_recent', { entry });
}
