import { useCallback, useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { MODES_OFF, type WritingMode, type WritingModes } from './writingModes';

/**
 * Writing-mode state for THIS window (6c-ii-b, D-A).
 *
 * Per-window and non-persistent: every window starts with both modes off, and
 * toggling in one window affects only that window. Replaces 6c-ii's
 * `useWritingModeSettings`, which made the modes app-wide — persisted, seeded
 * from a paint cache, reconciled against the durable store, and broadcast to
 * every other window through `settings://changed`. All of that machinery
 * existed to serve app-wide persistence and was removed with it: nothing to
 * persist means nothing to reconcile, nothing to broadcast, and no flash on
 * open to paint-cache against.
 *
 * The one thing that still crosses to Rust is the View menu's checkmarks. A
 * macOS menu bar is app-global, so it has to render *someone's* state — the
 * focused window's. This pushes that up on two occasions: whenever the modes
 * change, and whenever this window gains focus (because the menu then starts
 * representing a different window). Rust holds it purely to draw it; the
 * state itself lives here.
 */
export function useWindowWritingModes() {
  const [modes, setModes] = useState<WritingModes>(MODES_OFF);

  // Push to the menu on every change, and once on mount so a newly opened
  // window's (off, off) is what the checkmarks show.
  useEffect(() => {
    invoke('sync_view_menu', { typewriter: modes.typewriter, focus: modes.focus })
      .catch(() => {
        // A failed push leaves the checkmarks stale for this window. The modes
        // themselves still work, so this must not be fatal or user-visible.
      });
  }, [modes]);

  // The menu shows whichever window is in front, so re-assert on focus. Without
  // this, focusing a second window would leave the first window's checkmarks on
  // display over the second window's actual state.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) return;
        invoke('sync_view_menu', { typewriter: modes.typewriter, focus: modes.focus })
          .catch(() => {});
      })
      .then((un) => { if (disposed) un(); else unlisten = un; })
      .catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, [modes]);

  const setMode = useCallback((mode: WritingMode, on: boolean) => {
    setModes((prev) => ({ ...prev, [mode]: on }));
  }, []);

  /** Flip one mode — what the View menu's items do, since they carry no state. */
  const toggleMode = useCallback((mode: WritingMode) => {
    setModes((prev) => ({ ...prev, [mode]: !prev[mode] }));
  }, []);

  return { modes, setMode, toggleMode };
}
