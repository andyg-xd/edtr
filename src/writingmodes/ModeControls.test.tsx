// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { ModeControls } from './ModeControls';

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
const byName = (c: HTMLElement, re: RegExp) => buttons(c).find((b) => re.test(b.textContent ?? ''))!;

describe('ModeControls', () => {
  it('reports the current state through aria-pressed', async () => {
    const c = await render(<ModeControls modes={{ typewriter: true, focus: false }} onSetMode={() => {}} />);
    expect(byName(c, /typewriter/i).getAttribute('aria-pressed')).toBe('true');
    expect(byName(c, /focus/i).getAttribute('aria-pressed')).toBe('false');
  });

  it('asks for the opposite of the current value', async () => {
    const onSetMode = vi.fn();
    const c = await render(<ModeControls modes={{ typewriter: true, focus: false }} onSetMode={onSetMode} />);
    await act(async () => { byName(c, /typewriter/i).click(); });
    expect(onSetMode).toHaveBeenCalledWith('typewriter', false);
    await act(async () => { byName(c, /focus/i).click(); });
    expect(onSetMode).toHaveBeenCalledWith('focus', true);
  });
});
