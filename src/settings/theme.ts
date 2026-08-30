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

/**
 * Persist the mode: localStorage (sync paint-cache) + the durable Tauri store
 * (async). The theme still applies in-session if either fails.
 *
 * `onPersistError` is how the durable failure reaches the user. Without it the
 * rejection was swallowed, and the consequence was not merely a lost setting:
 * Rust broadcasts `settings://changed` only when the stored value CHANGES, so
 * a failed write produces no correcting broadcast either. The control kept
 * showing the new theme until the next launch, when `reconcileMode` read the
 * unwritten store and reverted it with no explanation.
 *
 * A callback rather than a returned promise, because every caller is
 * synchronous — `applyMode` runs inside a render effect, and awaiting it would
 * change when the theme paints. The localStorage failure stays silent by
 * design: it costs the paint cache, not the setting, and the durable store is
 * still the authority.
 */
export function setStoredMode(mode: ThemeMode, onPersistError?: (e: unknown) => void): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage unavailable — non-fatal, the durable store is the authority */
  }
  void saveTheme(mode).catch((e) => onPersistError?.(e));
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
export function applyMode(
  mode: ThemeMode,
  systemPrefersDark: boolean,
  onPersistError?: (e: unknown) => void,
): void {
  setStoredMode(mode, onPersistError);
  const effective = resolveEffective(mode, systemPrefersDark);
  const root = document.documentElement;
  if (effective === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
}
