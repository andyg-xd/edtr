// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { ThemeControl } from './ThemeControl';

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

async function render(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return container!;
}

const buttons = (c: HTMLElement) => Array.from(c.querySelectorAll('button'));

describe('ThemeControl', () => {
  it('renders System, Light, and Dark segments', async () => {
    const c = await render(<ThemeControl mode="system" onSetMode={() => {}} />);
    expect(buttons(c).map((b) => b.textContent)).toEqual(['System', 'Light', 'Dark']);
  });

  it('marks the active mode with aria-pressed', async () => {
    const c = await render(<ThemeControl mode="dark" onSetMode={() => {}} />);
    const pressed = buttons(c).filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(pressed[0].textContent).toBe('Dark');
  });

  it('calls onSetMode with the clicked value', async () => {
    const onSetMode = vi.fn();
    const c = await render(<ThemeControl mode="system" onSetMode={onSetMode} />);
    await act(async () => {
      buttons(c).find((b) => b.textContent === 'Light')!.click();
    });
    expect(onSetMode).toHaveBeenCalledWith('light');
  });
});
