import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ReloadBanner } from './ReloadBanner';

function render(ui: React.ReactElement) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  act(() => { createRoot(el).render(ui); });
  return el;
}

describe('ReloadBanner', () => {
  it('changed: shows Reload, no Keep mine', () => {
    const onReload = vi.fn();
    const el = render(<ReloadBanner state="changed" onReload={onReload} onKeepMine={() => {}} onDismiss={() => {}} />);
    const labels = [...el.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Reload');
    expect(labels).not.toContain('Keep mine');
  });
  it('conflict: shows discard + keep mine', () => {
    const el = render(<ReloadBanner state="conflict" onReload={() => {}} onKeepMine={() => {}} onDismiss={() => {}} />);
    const labels = [...el.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels.some((l) => l?.includes('Reload'))).toBe(true);
    expect(labels).toContain('Keep mine');
  });
  it('deleted: no Reload button', () => {
    const el = render(<ReloadBanner state="deleted" onReload={() => {}} onKeepMine={() => {}} onDismiss={() => {}} />);
    const labels = [...el.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels.some((l) => l?.includes('Reload'))).toBe(false);
  });
});
