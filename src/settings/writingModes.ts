export interface WritingModes {
  typewriter: boolean;
  focus: boolean;
}

export type WritingMode = keyof WritingModes;

export const MODES_OFF: WritingModes = { typewriter: false, focus: false };

/*
 * 6c-ii-b (D-A) removed `readCachedModes`/`writeCachedModes` and the
 * `edtr.writingModes` localStorage key they used. They existed to paint a
 * window's persisted modes synchronously and avoid a flicker when the Tauri
 * round trip landed. Per-window modes always start off, so there is nothing to
 * restore, nothing to paint early, and no flicker to prevent -- the cache
 * would only have been able to restore a value that must not be restored.
 */
