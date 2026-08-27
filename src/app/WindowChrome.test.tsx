// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';

// `WindowChrome` keeps the OS title in sync in a `useEffect`, so the window
// API has to exist. Mocked the same way `useWindowWritingModes.test.tsx` does.
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setTitle: () => Promise.resolve() }),
}));

import { WindowChrome } from './WindowChrome';

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => { container?.remove(); container = null; root = null; });

function render(node: ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

function rerender(node: ReactElement): void {
  act(() => root!.render(node));
}

function buttonNamed(scope: HTMLElement, label: string): HTMLButtonElement {
  const hit = [...scope.querySelectorAll('button')].find(
    (b) => b.textContent === label || b.getAttribute('aria-label') === label,
  );
  if (!hit) throw new Error(`no button labelled ${label}`);
  return hit as HTMLButtonElement;
}

const base = {
  name: 'notes.md', dirty: false, viewMode: 'live' as const, onSetViewMode: () => {},
  liveDisabled: false, themeMode: 'system' as const, onSetThemeMode: () => {},
  sidebarOpen: false, onToggleSidebar: () => {},
};

describe('WindowChrome — sidebar toggle', () => {
  it('sits before the document name', () => {
    const r = render(<WindowChrome {...base} />);
    const header = r.querySelector('.window-chrome')!;
    expect(header.firstElementChild).toBe(buttonNamed(r, 'Show outline'));
  });

  it('reports whether the sidebar is open', () => {
    const r = render(<WindowChrome {...base} />);
    expect(buttonNamed(r, 'Show outline').getAttribute('aria-pressed')).toBe('false');
    rerender(<WindowChrome {...base} sidebarOpen />);
    expect(buttonNamed(r, 'Hide outline').getAttribute('aria-pressed')).toBe('true');
  });

  // The toggle carried a ☰ glyph until 2026-08-27; it now carries an SVG, so
  // the button has NO text content and its accessible name comes entirely from
  // aria-label. Before, a dropped label still left a screen reader the glyph
  // to announce — poor, but something. Now it would leave an unnamed button.
  it('keeps an accessible name even though the icon carries no text', () => {
    const r = render(<WindowChrome {...base} />);
    const btn = buttonNamed(r, 'Show outline');
    expect(btn.textContent?.trim()).toBe('');
    expect(btn.getAttribute('aria-label')).toBe('Show outline');
  });

  it('marks the icon decorative, so it is not announced twice', () => {
    const r = render(<WindowChrome {...base} />);
    const svg = buttonNamed(r, 'Show outline').querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
  });

  it('asks the caller to toggle', () => {
    const onToggleSidebar = vi.fn();
    const r = render(<WindowChrome {...base} onToggleSidebar={onToggleSidebar} />);
    act(() => { buttonNamed(r, 'Show outline').click(); });
    expect(onToggleSidebar).toHaveBeenCalledTimes(1);
  });
});
