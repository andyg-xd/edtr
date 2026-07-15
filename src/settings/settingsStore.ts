import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { ThemeMode } from './theme';

export interface StoredSettings {
  theme: ThemeMode;
}

/** Read persisted settings from the durable Tauri store; null if none saved yet
 * (absent or corrupt file). */
export async function loadSettings(): Promise<StoredSettings | null> {
  return (await invoke<StoredSettings | null>('get_settings')) ?? null;
}

/** Persist the theme mode durably; Rust broadcasts settings://changed to all
 * windows (only if the value changed). */
export async function saveTheme(mode: ThemeMode): Promise<void> {
  await invoke('set_theme', { mode });
}

/** Subscribe (window-scoped) to cross-window settings changes. */
export async function onSettingsChanged(cb: (s: StoredSettings) => void): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen<StoredSettings>('settings://changed', (e) => cb(e.payload));
}
