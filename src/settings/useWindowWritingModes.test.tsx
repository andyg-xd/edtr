// @vitest-environment jsdom
import { vi } from 'vitest';

const invoke = vi.fn().mockResolvedValue(undefined);
let focusListener: ((e: { payload: boolean }) => void) | null = null;
const unlistenFocus = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onFocusChanged: (cb: (e: { payload: boolean }) => void) => {
      focusListener = cb;
      return Promise.resolve(unlistenFocus);
    },
  }),
}));

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { useWindowWritingModes } from './useWindowWritingModes';

let container: HTMLDivElement | null = null;

async function render(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return root;
}

/** Drives the hook and exposes its API to the test through a mutable handle. */
function harness() {
  const api: { current: ReturnType<typeof useWindowWritingModes> | null } = { current: null };
  function Probe() {
    api.current = useWindowWritingModes();
    return null;
  }
  return { api, Probe };
}

function menuPushes() {
  return invoke.mock.calls.filter((c) => c[0] === 'sync_view_menu').map((c) => c[1]);
}

beforeEach(() => { invoke.mockClear(); unlistenFocus.mockClear(); focusListener = null; });
afterEach(() => { container?.remove(); container = null; });

describe('useWindowWritingModes (per-window, 6c-ii-b D-A)', () => {
  it('starts with BOTH modes off', async () => {
    // D-A, and the load-bearing half of it: nothing persists, so a new window
    // can never open with a mode already on. 6c-ii's hook seeded from a paint
    // cache and would.
    const { api, Probe } = harness();
    await render(<Probe />);
    expect(api.current!.modes).toEqual({ typewriter: false, focus: false });
  });

  it('setMode changes only this window\'s state', async () => {
    const { api, Probe } = harness();
    await render(<Probe />);
    await act(async () => { api.current!.setMode('typewriter', true); });
    expect(api.current!.modes).toEqual({ typewriter: true, focus: false });
    await act(async () => { api.current!.setMode('focus', true); });
    expect(api.current!.modes).toEqual({ typewriter: true, focus: true });
  });

  it('toggleMode flips, so the menu item needs no state of its own', async () => {
    // The View menu items are plain commands: Rust no longer knows the value,
    // so the window has to be the one that flips it.
    const { api, Probe } = harness();
    await render(<Probe />);
    await act(async () => { api.current!.toggleMode('focus'); });
    expect(api.current!.modes.focus).toBe(true);
    await act(async () => { api.current!.toggleMode('focus'); });
    expect(api.current!.modes.focus).toBe(false);
  });

  it('pushes the menu checkmarks on mount and on every change', async () => {
    const { api, Probe } = harness();
    await render(<Probe />);
    expect(menuPushes()).toEqual([{ typewriter: false, focus: false }]);
    await act(async () => { api.current!.setMode('typewriter', true); });
    const pushes = menuPushes();
    expect(pushes[pushes.length - 1]).toEqual({ typewriter: true, focus: false });
  });

  it('re-pushes when the window GAINS focus, because the menu shows whoever is in front', async () => {
    // Without this, focusing a second window leaves the first window's
    // checkmarks on display over the second window's actual state.
    const { api, Probe } = harness();
    await render(<Probe />);
    await act(async () => { api.current!.setMode('focus', true); });
    invoke.mockClear();
    await act(async () => { focusListener?.({ payload: true }); });
    expect(menuPushes()).toEqual([{ typewriter: false, focus: true }]);
  });

  it('does NOT push when the window LOSES focus', async () => {
    // The window taking focus pushes its own state; a blurring window pushing
    // too would race and could overwrite the newly focused window's values.
    const { Probe } = harness();
    await render(<Probe />);
    invoke.mockClear();
    await act(async () => { focusListener?.({ payload: false }); });
    expect(menuPushes()).toEqual([]);
  });

  it('survives a failed menu push', async () => {
    // The checkmarks going stale must never break the modes themselves.
    invoke.mockRejectedValueOnce(new Error('no menu'));
    const { api, Probe } = harness();
    await render(<Probe />);
    await act(async () => { api.current!.setMode('typewriter', true); });
    expect(api.current!.modes.typewriter).toBe(true);
  });
});
