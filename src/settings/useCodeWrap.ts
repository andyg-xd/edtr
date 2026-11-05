import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { loadSettings, saveCodeWrap } from './settingsStore';

/**
 * Owns whether THIS window's Code view wraps long lines. Each window wraps on
 * its own: a window starts with the stored value, which is the last choice
 * made in any window, and a toggle here changes only this window. The new
 * value is saved as the last choice so the next window opens with it, but
 * windows already open never follow it.
 *
 * The View menu's Wrap Lines mark shows the focused window's state, so this
 * reports to it the way `useWindowWritingModes` does: on every change, and
 * whenever the window gains focus. `syncWrapMenu` reports an unchanged state,
 * for a wrap command that this window handled without changing it.
 *
 * `onPersistError` is called when the DURABLE write fails. The toggle still
 * applies to this window, but new windows would not start with it, so the
 * failure is reported rather than swallowed. It is read through a ref so a
 * fresh closure per render does not retrigger anything.
 */
export function useCodeWrap(onPersistError?: (e: unknown) => void): {
  codeWrap: boolean;
  toggleCodeWrap: () => void;
  syncWrapMenu: () => void;
} {
  const [codeWrap, setCodeWrap] = useState(true);

  const persistErrorRef = useRef(onPersistError);
  persistErrorRef.current = onPersistError;

  useEffect(() => {
    let disposed = false;
    loadSettings()
      .then((stored) => { if (!disposed) setCodeWrap(stored?.codeWrap ?? true); })
      .catch(() => {
        /* store unavailable — non-fatal, wrapping stays at its default */
      });
    return () => { disposed = true; };
  }, []);

  const syncWrapMenu = useCallback(() => {
    invoke('sync_view_menu', { wrap: codeWrap }).catch(() => {
      // A failed report leaves the checkmark stale; wrapping itself still works.
    });
  }, [codeWrap]);

  useEffect(() => { syncWrapMenu(); }, [syncWrapMenu]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => { if (focused) syncWrapMenu(); })
      .then((un) => { if (disposed) un(); else unlisten = un; })
      .catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, [syncWrapMenu]);

  const toggleCodeWrap = useCallback(() => {
    const next = !codeWrap;
    setCodeWrap(next);
    void saveCodeWrap(next).catch((e) => persistErrorRef.current?.(e));
  }, [codeWrap]);

  return { codeWrap, toggleCodeWrap, syncWrapMenu };
}
