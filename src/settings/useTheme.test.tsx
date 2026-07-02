// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { useTheme } from './useTheme';

// Controllable matchMedia mock. `matches` reads a shared flag; `setDark` fires
// the registered 'change' listeners with the new value.
function installMatchMedia(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<(e: { matches: boolean }) => void>();
  (window as unknown as { matchMedia: unknown }).matchMedia = vi.fn(() => ({
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.delete(cb),
  }));
  return {
    setDark(v: boolean) {
      dark = v;
      listeners.forEach((cb) => cb({ matches: v }));
    },
    listenerCount: () => listeners.size,
  };
}

function Probe() {
  const { mode, effective, setMode } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="effective">{effective}</span>
      <button data-testid="to-light" onClick={() => setMode('light')}>light</button>
      <button data-testid="to-system" onClick={() => setMode('system')}>system</button>
    </div>
  );
}

let container: HTMLDivElement | null = null;
beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
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
  return { container: container!, root };
}

const txt = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`)!.textContent;

describe('useTheme', () => {
  it('System mode follows the OS (dark) and sets the attribute', async () => {
    installMatchMedia(true);
    const { container: c } = await render(<Probe />);
    expect(txt(c, 'mode')).toBe('system');
    expect(txt(c, 'effective')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('setMode(light) overrides, clears the attribute, and persists', async () => {
    installMatchMedia(true);
    const { container: c } = await render(<Probe />);
    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="to-light"]')!.click();
    });
    expect(txt(c, 'mode')).toBe('light');
    expect(txt(c, 'effective')).toBe('light');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('edtr.theme')).toBe('light');
  });

  it('System mode reacts live to an OS appearance change', async () => {
    const media = installMatchMedia(false);
    const { container: c } = await render(<Probe />);
    expect(txt(c, 'effective')).toBe('light');
    await act(async () => media.setDark(true));
    expect(txt(c, 'effective')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('removes the OS listener on unmount', async () => {
    const media = installMatchMedia(false);
    const { root } = await render(<Probe />);
    expect(media.listenerCount()).toBe(1);
    await act(async () => root.unmount());
    expect(media.listenerCount()).toBe(0);
  });
});
