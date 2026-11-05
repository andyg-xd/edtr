import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { ThemeMode } from './theme';

/**
 * What Rust persists. 6c-ii-b removed `typewriter`/`focus`: under D-A the
 * writing modes are per-window state that always starts off, so they are not
 * settings at all. The Rust struct dropped the fields to match, and an older
 * settings file carrying them still loads (serde ignores unknown fields).
 */
export interface StoredSettings {
  theme: ThemeMode;
  codeWrap: boolean;
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

/** Persist the last Code view wrap choice, which new windows start with. Other
 * windows that are already open do not follow it. */
export async function saveCodeWrap(enabled: boolean): Promise<void> {
  await invoke('set_code_wrap', { enabled });
}

/** Subscribe (window-scoped) to cross-window settings changes. */
export async function onSettingsChanged(cb: (s: StoredSettings) => void): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen<StoredSettings>('settings://changed', (e) => cb(e.payload));
}
