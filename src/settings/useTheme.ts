import { useCallback, useEffect, useState } from 'react';
import { applyMode, getStoredMode, resolveEffective, type EffectiveTheme, type ThemeMode } from './theme';

const QUERY = '(prefers-color-scheme: dark)';

/**
 * Owns the theme mode and the resolved effective theme. Tracks the OS
 * appearance via matchMedia so 'system' mode reacts live, and reflects the
 * resolved theme onto <html> (via applyMode) whenever mode or OS preference
 * changes. One instance lives in EditorWindow; its `effective` feeds CodeView
 * and its `mode`/`setMode` feed the ThemeControl.
 */
export function useTheme(): {
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

  useEffect(() => {
    applyMode(mode, systemPrefersDark);
  }, [mode, systemPrefersDark]);

  const setMode = useCallback((m: ThemeMode) => setModeState(m), []);
  const effective = resolveEffective(mode, systemPrefersDark);
  return { mode, effective, setMode };
}
