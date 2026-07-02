export type ThemeMode = 'system' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';

const STORAGE_KEY = 'edtr.theme';
const MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

/** Read the persisted mode; defaults to 'system' if absent or invalid. */
export function getStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && (MODES as readonly string[]).includes(v) ? (v as ThemeMode) : 'system';
  } catch {
    return 'system';
  }
}

/** Persist the mode. Storage failures are non-fatal (theme still applies in-session). */
export function setStoredMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/** Resolve mode + OS preference to the concrete theme to render. */
export function resolveEffective(mode: ThemeMode, systemPrefersDark: boolean): EffectiveTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}

/**
 * Persist `mode` and reflect the RESOLVED effective theme onto <html>:
 * effective 'dark'  -> data-theme="dark"; effective 'light' -> attribute removed
 * (the base :root IS light). `systemPrefersDark` is injected so this stays pure
 * (no matchMedia call here — the caller owns the OS query).
 */
export function applyMode(mode: ThemeMode, systemPrefersDark: boolean): void {
  setStoredMode(mode);
  const effective = resolveEffective(mode, systemPrefersDark);
  const root = document.documentElement;
  if (effective === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
}
