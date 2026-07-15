// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('./settingsStore', () => ({ saveTheme: vi.fn().mockResolvedValue(undefined) }));
import { saveTheme } from './settingsStore';
import {
  getStoredMode,
  setStoredMode,
  resolveEffective,
  applyMode,
  reconcileMode,
  type ThemeMode,
} from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('resolveEffective', () => {
  const cases: [ThemeMode, boolean, 'light' | 'dark'][] = [
    ['light', false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['dark', true, 'dark'],
    ['system', false, 'light'],
    ['system', true, 'dark'],
  ];
  it.each(cases)('mode=%s prefersDark=%s -> %s', (mode, prefersDark, expected) => {
    expect(resolveEffective(mode, prefersDark)).toBe(expected);
  });
});

describe('storage', () => {
  it('defaults to system when nothing is stored', () => {
    expect(getStoredMode()).toBe('system');
  });
  it('round-trips a stored mode', () => {
    setStoredMode('dark');
    expect(getStoredMode()).toBe('dark');
    expect(localStorage.getItem('edtr.theme')).toBe('dark');
  });
  it('falls back to system on an invalid stored value', () => {
    localStorage.setItem('edtr.theme', 'purple');
    expect(getStoredMode()).toBe('system');
  });
});

describe('applyMode', () => {
  it('sets data-theme="dark" when the effective theme is dark', () => {
    applyMode('dark', false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(getStoredMode()).toBe('dark');
  });
  it('removes data-theme when the effective theme is light', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    applyMode('light', true);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(getStoredMode()).toBe('light');
  });
  it('system + prefersDark resolves to the dark attribute', () => {
    applyMode('system', true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(getStoredMode()).toBe('system');
  });
});

describe('reconcileMode', () => {
  it('store empty (null) → seed with local', () => {
    expect(reconcileMode('dark', null)).toEqual({ seed: 'dark' });
  });
  it('store equals local → no action', () => {
    expect(reconcileMode('dark', 'dark')).toEqual({});
  });
  it('store differs → adopt the store value', () => {
    expect(reconcileMode('light', 'dark')).toEqual({ adopt: 'dark' });
  });
});

describe('setStoredMode write-through', () => {
  it('writes localStorage AND calls saveTheme', () => {
    localStorage.clear();
    (saveTheme as unknown as ReturnType<typeof vi.fn>).mockClear();
    setStoredMode('dark');
    expect(localStorage.getItem('edtr.theme')).toBe('dark');
    expect(saveTheme).toHaveBeenCalledWith('dark');
  });
});
