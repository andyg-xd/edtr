// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const invoke = vi.fn();
const listen = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ listen: (...a: unknown[]) => listen(...a) }),
}));

import { useWritingModeSettings } from './useWritingModeSettings';

/**
 * Minimal stand-in for @testing-library/react's `renderHook`. This repo has
 * no testing-library dependency (not in package.json, not in node_modules)
 * and the project rule is "no new dependencies — not one", so this mounts
 * the hook through a real component via react-dom/client instead, the same
 * way the existing useTheme.test.tsx in this same directory does.
 */
function renderHook<T>(useHook: () => T) {
  let current: T;
  function Probe() {
    current = useHook();
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  return {
    result: { get current() { return current; } },
    container,
    // Flushes the render + any effects it synchronously triggers, but does
    // NOT drain microtasks queued by promises those effects kick off --
    // matching the instant a real window paints, before the first Tauri
    // round trip can possibly have landed.
    mountSync() { act(() => { root.render(<Probe />); }); },
    async mount() { await act(async () => { root.render(<Probe />); }); },
  };
}

/** Minimal stand-in for @testing-library/react's `waitFor`, same rationale as above. */
async function waitFor(check: () => void, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      check();
      return;
    } catch (err) {
      if (Date.now() - start > timeoutMs) throw err;
      await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    }
  }
}

describe('useWritingModeSettings', () => {
  const containers: HTMLDivElement[] = [];

  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
    localStorage.clear();
    invoke.mockResolvedValue(null);
    listen.mockResolvedValue(() => {});
  });

  afterEach(() => {
    containers.splice(0).forEach((c) => c.remove());
  });

  it('starts from the paint cache so a window does not flash undimmed', () => {
    localStorage.setItem('edtr.writingModes', JSON.stringify({ typewriter: true, focus: false }));
    const h = renderHook(() => useWritingModeSettings());
    containers.push(h.container);
    h.mountSync();
    // Synchronously on first render — before any Tauri round trip resolves.
    expect(h.result.current.modes).toEqual({ typewriter: true, focus: false });
  });

  it('adopts the durable value when it differs from the cache', async () => {
    localStorage.setItem('edtr.writingModes', JSON.stringify({ typewriter: false, focus: false }));
    invoke.mockResolvedValue({ theme: 'dark', typewriter: true, focus: true });
    const h = renderHook(() => useWritingModeSettings());
    containers.push(h.container);
    await h.mount();
    await waitFor(() => expect(h.result.current.modes).toEqual({ typewriter: true, focus: true }));
  });

  it('writes through to Rust when a mode is set', async () => {
    const h = renderHook(() => useWritingModeSettings());
    containers.push(h.container);
    await h.mount();
    await act(async () => { h.result.current.setMode('focus', true); });
    expect(invoke).toHaveBeenCalledWith('set_writing_mode', { mode: 'focus', on: true });
  });

  it('adopts a cross-window change from settings://changed', async () => {
    let handler: ((e: { payload: unknown }) => void) | null = null;
    listen.mockImplementation((_name: string, cb: (e: { payload: unknown }) => void) => {
      handler = cb;
      return Promise.resolve(() => {});
    });
    const h = renderHook(() => useWritingModeSettings());
    containers.push(h.container);
    await h.mount();
    await waitFor(() => expect(handler).not.toBeNull());
    await act(async () => {
      handler!({ payload: { theme: 'dark', typewriter: true, focus: false } });
    });
    expect(h.result.current.modes).toEqual({ typewriter: true, focus: false });
  });
});
