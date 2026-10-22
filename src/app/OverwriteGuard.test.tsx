import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { OverwriteGuard } from './OverwriteGuard';

async function render(node: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(node));
  return container;
}

describe('OverwriteGuard', () => {
  it('names the file and says what saving would do', async () => {
    const c = await render(<OverwriteGuard path="/docs/notes.md" onOverwrite={vi.fn()} onCancel={vi.fn()} />);
    expect(c.textContent).toContain('"notes.md" was changed by another app or window');
    expect(c.textContent).toContain('Saving now replaces those changes with yours.');
  });

  it('overwrites and cancels through its buttons', async () => {
    const onOverwrite = vi.fn();
    const onCancel = vi.fn();
    const c = await render(<OverwriteGuard path="/docs/notes.md" onOverwrite={onOverwrite} onCancel={onCancel} />);
    await act(async () => c.querySelector<HTMLButtonElement>('.btn--danger')!.click());
    await act(async () => c.querySelector<HTMLButtonElement>('.btn--secondary')!.click());
    expect(onOverwrite).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('starts on Cancel, so Return never destroys the other changes by accident', async () => {
    const c = await render(<OverwriteGuard path="/docs/notes.md" onOverwrite={vi.fn()} onCancel={vi.fn()} />);
    expect(document.activeElement).toBe(c.querySelector('.btn--secondary'));
  });
});
