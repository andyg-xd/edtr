import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyMode,
  getStoredMode,
  reconcileMode,
  resolveEffective,
  type EffectiveTheme,
  type ThemeMode,
} from './theme';
import { loadSettings, saveTheme, onSettingsChanged } from './settingsStore';
import type { UnlistenFn } from '@tauri-apps/api/event';

const QUERY = '(prefers-color-scheme: dark)';

/**
 * Owns the theme mode and the resolved effective theme. Tracks the OS
 * appearance via matchMedia so 'system' mode reacts live, and reflects the
 * resolved theme onto <html> (via applyMode) whenever mode or OS preference
 * changes. One instance lives in EditorWindow; its `effective` feeds CodeView
 * and its `mode`/`setMode` feed the ThemeControl.
 *
 * `onPersistError` is called when the DURABLE write fails. The theme still
 * applies for the session, so this is not fatal — but it must not stay silent
 * either: Rust only broadcasts a change when the stored value actually
 * changes, so nothing corrects the window, and the choice reverts unexplained
 * on the next launch. EditorWindow surfaces it through the same notice Phase
 * 5f uses for the rest of this class.
 */
export function useTheme(onPersistError?: (e: unknown) => void): {
  mode: ThemeMode;
  effective: EffectiveTheme;
  setMode: (mode: ThemeMode) => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(() => getStoredMode());
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // `onPersistError` is deliberately NOT a dependency. It is a fresh closure on
  // every render of the consumer, so listing it would re-run applyMode — and a
  // durable write — on every render rather than on an actual theme change. The
  // ref keeps the latest callback reachable without making identity a trigger.
  const persistErrorRef = useRef(onPersistError);
  persistErrorRef.current = onPersistError;

  useEffect(() => {
    applyMode(mode, systemPrefersDark, (e) => persistErrorRef.current?.(e));
  }, [mode, systemPrefersDark]);

  // Reconcile this window's cached mode with the durable store, then live-sync.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    (async () => {
      const stored = await loadSettings();
      if (disposed) return;
      const { seed, adopt } = reconcileMode(getStoredMode(), stored?.theme ?? null);
      if (seed !== undefined) void saveTheme(seed).catch((e) => persistErrorRef.current?.(e));
      if (adopt !== undefined) setModeState(adopt);
      unlisten = await onSettingsChanged((s) => {
        if (!disposed) setModeState(s.theme);
      });
      if (disposed) unlisten();
    })().catch(() => {
      /* store reconcile/subscription unavailable — non-fatal, cached mode already applied */
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const setMode = useCallback((m: ThemeMode) => setModeState(m), []);
  const effective = resolveEffective(mode, systemPrefersDark);
  return { mode, effective, setMode };
}
