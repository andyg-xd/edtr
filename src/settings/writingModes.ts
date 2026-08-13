export interface WritingModes {
  typewriter: boolean;
  focus: boolean;
}

export type WritingMode = keyof WritingModes;

export const MODES_OFF: WritingModes = { typewriter: false, focus: false };

const STORAGE_KEY = 'edtr.writingModes';

/**
 * The synchronous paint cache, mirroring what `theme.ts` does for the theme.
 * Without it a window paints undimmed and unscrolled, then snaps once the
 * Tauri round trip lands — a visible flicker on every window open.
 *
 * Anything unparseable reads as both modes off, which is the safe direction:
 * a window that fails to restore a mode is mildly annoying, one that dims
 * without being asked looks broken.
 */
export function readCachedModes(): WritingModes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return MODES_OFF;
    const parsed = JSON.parse(raw) as Partial<WritingModes>;
    return { typewriter: parsed.typewriter === true, focus: parsed.focus === true };
  } catch {
    return MODES_OFF;
  }
}

export function writeCachedModes(modes: WritingModes): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(modes));
  } catch {
    // A full or disabled localStorage must not break the toggle itself.
  }
}
