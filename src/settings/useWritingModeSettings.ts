import { useCallback, useEffect, useState } from 'react';
import { loadSettings, onSettingsChanged, setWritingMode } from './settingsStore';
import { readCachedModes, writeCachedModes, type WritingMode, type WritingModes } from './writingModes';

/**
 * App-wide writing-mode state for one window (D5).
 *
 * Seeded synchronously from the paint cache, reconciled against the durable
 * store on mount, and kept in step with other windows through
 * `settings://changed`. The write goes to Rust, which owns the whole path
 * (spec §6.3) — this hook never writes the durable store directly.
 */
export function useWritingModeSettings() {
  const [modes, setModes] = useState<WritingModes>(readCachedModes);

  const adopt = useCallback((next: WritingModes) => {
    setModes(next);
    writeCachedModes(next);
  }, []);

  useEffect(() => {
    let alive = true;
    loadSettings()
      .then((s) => {
        if (!alive || !s) return;
        adopt({ typewriter: s.typewriter === true, focus: s.focus === true });
      })
      .catch(() => {
        // A failed read leaves the cache-seeded value in place; a window that
        // cannot reach the store should not lose the mode the user set.
      });
    return () => { alive = false; };
  }, [adopt]);

  useEffect(() => {
    const un = onSettingsChanged((s) => {
      adopt({ typewriter: s.typewriter === true, focus: s.focus === true });
    });
    return () => { un.then((f) => f()).catch(() => {}); };
  }, [adopt]);

  const setMode = useCallback((mode: WritingMode, on: boolean) => {
    // Optimistic locally so the toggle feels immediate; Rust's broadcast is
    // what makes it true everywhere, and emit-if-changed means this cannot
    // echo back into a loop.
    adopt({ ...modes, [mode]: on });
    setWritingMode(mode, on).catch(() => {});
  }, [adopt, modes]);

  return { modes, setMode };
}
