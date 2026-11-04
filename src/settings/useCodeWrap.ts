import { useCallback, useEffect, useRef, useState } from 'react';
import { loadSettings, saveCodeWrap, onSettingsChanged } from './settingsStore';
import type { UnlistenFn } from '@tauri-apps/api/event';

/**
 * Owns whether the Code view wraps long lines. Wrapping is app-wide and
 * persisted, so it starts on, adopts the stored value, and follows
 * settings://changed from other windows.
 *
 * `onPersistError` is called when the DURABLE write fails. The toggle still
 * applies for this session, but it would revert unexplained on the next
 * launch, so the failure is reported rather than swallowed. It is read
 * through a ref so a fresh closure per render does not retrigger anything.
 */
export function useCodeWrap(onPersistError?: (e: unknown) => void): {
  codeWrap: boolean;
  toggleCodeWrap: () => void;
} {
  const [codeWrap, setCodeWrap] = useState(true);

  const persistErrorRef = useRef(onPersistError);
  persistErrorRef.current = onPersistError;

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    (async () => {
      const stored = await loadSettings();
      if (disposed) return;
      setCodeWrap(stored?.codeWrap ?? true);
      unlisten = await onSettingsChanged((s) => {
        if (!disposed) setCodeWrap(s.codeWrap ?? true);
      });
      if (disposed) unlisten();
    })().catch(() => {
      /* store unavailable — non-fatal, wrapping stays at its default */
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const toggleCodeWrap = useCallback(() => {
    const next = !codeWrap;
    setCodeWrap(next);
    void saveCodeWrap(next).catch((e) => persistErrorRef.current?.(e));
  }, [codeWrap]);

  return { codeWrap, toggleCodeWrap };
}
