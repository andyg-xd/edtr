// @vitest-environment jsdom
import { vi } from 'vitest';
vi.mock('./settingsStore', () => ({
  loadSettings: vi.fn().mockResolvedValue(null),
  saveCodeWrap: vi.fn().mockResolvedValue(undefined),
  onSettingsChanged: vi.fn().mockResolvedValue(() => {}),
}));

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { useCodeWrap } from './useCodeWrap';
import { loadSettings, saveCodeWrap, onSettingsChanged } from './settingsStore';

let onPersistError: ((e: unknown) => void) | undefined;

function Probe() {
  const { codeWrap, toggleCodeWrap } = useCodeWrap(onPersistError);
  return (
    <div>
      <span data-testid="wrap">{String(codeWrap)}</span>
      <button data-testid="toggle" onClick={toggleCodeWrap}>toggle</button>
    </div>
  );
}

let container: HTMLDivElement | null = null;
beforeEach(() => {
  vi.mocked(loadSettings).mockResolvedValue(null);
  vi.mocked(saveCodeWrap).mockClear().mockResolvedValue(undefined);
  vi.mocked(onSettingsChanged).mockResolvedValue(() => {});
  onPersistError = undefined;
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

  it('adopts a broadcast change', async () => {
    let emit: (s: { theme: 'system'; codeWrap: boolean }) => void = () => {};
    vi.mocked(onSettingsChanged).mockImplementation(async (cb) => {
      emit = cb;
      return () => {};
    });
    const c = await render(<Probe />);
    await act(async () => emit({ theme: 'system', codeWrap: false }));
    expect(wrap(c)).toBe('false');
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
});
