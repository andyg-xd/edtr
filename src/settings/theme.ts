import { saveTheme } from './settingsStore';

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

/** Persist the mode: localStorage (sync paint-cache) + the durable Tauri store
 * (async, fire-and-forget). Storage failures are non-fatal (theme still applies
 * in-session). */
export function setStoredMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage unavailable — non-fatal */
  }
  void saveTheme(mode).catch(() => {
    /* durable persist failed — non-fatal, applied in-session + cached locally */
  });
}

/**
 * Decide how a window's local (localStorage) mode reconciles with the durable
 * store on mount. `seed` = store empty → write local into it (first-run
 * migration + corrupt-file recovery); `adopt` = store has a different value →
 * take it as truth; neither = already in sync.
 */
export function reconcileMode(
  local: ThemeMode,
  stored: ThemeMode | null,
): { seed?: ThemeMode; adopt?: ThemeMode } {
  if (stored === null) return { seed: local };
  if (stored !== local) return { adopt: stored };
  return {};
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
