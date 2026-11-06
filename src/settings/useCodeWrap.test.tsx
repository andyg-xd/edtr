// @vitest-environment jsdom
import { vi } from 'vitest';
vi.mock('./settingsStore', () => ({
  loadSettings: vi.fn().mockResolvedValue(null),
  saveCodeWrap: vi.fn().mockResolvedValue(undefined),
  onSettingsChanged: vi.fn().mockResolvedValue(() => {}),
}));

const invoke = vi.fn().mockResolvedValue(undefined);
let focusListener: ((e: { payload: boolean }) => void) | null = null;
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onFocusChanged: (cb: (e: { payload: boolean }) => void) => {
      focusListener = cb;
      return Promise.resolve(() => {});
    },
  }),
}));

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { useCodeWrap } from './useCodeWrap';
import { loadSettings, saveCodeWrap, onSettingsChanged } from './settingsStore';

let onPersistError: ((e: unknown) => void) | undefined;
let liveReport: ReturnType<typeof useCodeWrap>['reportLiveWrap'] = () => {};

function Probe() {
  const { codeWrap, toggleCodeWrap, syncWrapMenu, reportLiveWrap } = useCodeWrap(onPersistError);
  liveReport = reportLiveWrap;
  return (
    <div>
      <span data-testid="wrap">{String(codeWrap)}</span>
      <button data-testid="toggle" onClick={toggleCodeWrap}>toggle</button>
      <button data-testid="sync" onClick={syncWrapMenu}>sync</button>
    </div>
  );
}

let container: HTMLDivElement | null = null;
beforeEach(() => {
  vi.mocked(loadSettings).mockResolvedValue(null);
  vi.mocked(saveCodeWrap).mockClear().mockResolvedValue(undefined);
  vi.mocked(onSettingsChanged).mockResolvedValue(() => {});
  onPersistError = undefined;
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  focusListener = null;
});
afterEach(() => {
  container?.remove();
  container = null;
});

async function render(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return container!;
}

const wrap = (c: HTMLElement) => c.querySelector('[data-testid="wrap"]')!.textContent;
const toggle = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-testid="toggle"]')!.click();
const sync = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-testid="sync"]')!.click();
const menuReports = () => invoke.mock.calls.filter((c) => c[0] === 'sync_view_menu').map((c) => c[1]);

describe('useCodeWrap', () => {
  it('starts on', async () => {
    const c = await render(<Probe />);
    expect(wrap(c)).toBe('true');
  });

  it('adopts a stored false', async () => {
    vi.mocked(loadSettings).mockResolvedValue({ theme: 'system', codeWrap: false });
    const c = await render(<Probe />);
    expect(wrap(c)).toBe('false');
  });

  it('does not follow another window turning wrapping off', async () => {
    // Each window wraps on its own: the stored value is only where a NEW
    // window starts, so a change saved by another window must not reach this one.
    let emit: (s: { theme: 'system'; codeWrap: boolean }) => void = () => {};
    vi.mocked(onSettingsChanged).mockImplementation(async (cb) => {
      emit = cb;
      return () => {};
    });
    const c = await render(<Probe />);
    await act(async () => emit({ theme: 'system', codeWrap: false }));
    expect(wrap(c)).toBe('true');
  });

  it('toggling flips immediately and persists the new value', async () => {
    const c = await render(<Probe />);
    await act(async () => toggle(c));
    expect(wrap(c)).toBe('false');
    expect(saveCodeWrap).toHaveBeenCalledWith(false);
  });

  it('reports a failed write through onPersistError', async () => {
    const err = new Error('disk full');
    vi.mocked(saveCodeWrap).mockRejectedValue(err);
    onPersistError = vi.fn();
    const c = await render(<Probe />);
    await act(async () => toggle(c));
    expect(onPersistError).toHaveBeenCalledWith(err);
  });

  it('reports its wrap state to the menu once it has adopted the stored value', async () => {
    vi.mocked(loadSettings).mockResolvedValue({ theme: 'system', codeWrap: false });
    await render(<Probe />);
    expect(menuReports().at(-1)).toEqual({ wrap: false, wrapEnabled: true });
  });

  it('reports the new state after a toggle', async () => {
    const c = await render(<Probe />);
    invoke.mockClear();
    await act(async () => toggle(c));
    expect(menuReports()).toEqual([{ wrap: false, wrapEnabled: true }]);
  });

  it('re-reports an unchanged state on request', async () => {
    // A Markdown Live wrap command flips a code block, not this state, yet
    // macOS has already flipped the checkmark on the click.
    const c = await render(<Probe />);
    invoke.mockClear();
    await act(async () => sync(c));
    expect(menuReports()).toEqual([{ wrap: true, wrapEnabled: true }]);
  });

  it('re-reports when the window gains focus, and not when it loses it', async () => {
    const c = await render(<Probe />);
    await act(async () => toggle(c));
    invoke.mockClear();
    await act(async () => focusListener?.({ payload: false }));
    expect(menuReports()).toEqual([]);
    await act(async () => focusListener?.({ payload: true }));
    expect(menuReports()).toEqual([{ wrap: false, wrapEnabled: true }]);
  });

  it('keeps working when the menu report fails', async () => {
    invoke.mockRejectedValue(new Error('no menu'));
    const c = await render(<Probe />);
    await act(async () => toggle(c));
    expect(wrap(c)).toBe('false');
  });
  it('shows a Live report instead of its own state, greyed out when the report says so', async () => {
    // Live view shows no Code view, so the mark describes the caret's code
    // block there, and the item is disabled where a wrap command does nothing.
    await render(<Probe />);
    invoke.mockClear();
    await act(async () => liveReport({ checked: false, enabled: true }));
    await act(async () => liveReport({ checked: false, enabled: false }));
    expect(menuReports()).toEqual([
      { wrap: false, wrapEnabled: true },
      { wrap: false, wrapEnabled: false },
    ]);
  });

  it('sends nothing for a Live report identical to the last one', async () => {
    // Reported on every Live transaction, most of them caret moves inside one block.
    await render(<Probe />);
    await act(async () => liveReport({ checked: true, enabled: true }));
    invoke.mockClear();
    await act(async () => liveReport({ checked: true, enabled: true }));
    expect(menuReports()).toEqual([]);
  });

  it('goes back to its own state when the Live report is withdrawn', async () => {
    const c = await render(<Probe />);
    await act(async () => toggle(c));
    await act(async () => liveReport({ checked: true, enabled: false }));
    invoke.mockClear();
    await act(async () => liveReport(null));
    expect(menuReports()).toEqual([{ wrap: false, wrapEnabled: true }]);
  });

  it('re-sends the Live report on focus and on request', async () => {
    const c = await render(<Probe />);
    await act(async () => liveReport({ checked: false, enabled: false }));
    invoke.mockClear();
    await act(async () => focusListener?.({ payload: true }));
    await act(async () => sync(c));
    expect(menuReports()).toEqual([
      { wrap: false, wrapEnabled: false },
      { wrap: false, wrapEnabled: false },
    ]);
  });
});
