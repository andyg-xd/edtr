import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ReplaceAllGuard } from './ReplaceAllGuard';

async function render(node: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(node));
  return container;
}

describe('ReplaceAllGuard', () => {
  it('names the exact number of matches and warns about undo', async () => {
    const c = await render(<ReplaceAllGuard count={47} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(c.textContent).toContain('Replace all 47 matches?');
    // Undo is known-unreliable in Live view, which is the whole reason this
    // dialog exists (spec 7.1).
    expect(c.textContent).toContain('Undo may not fully reverse this.');
  });

  it('confirms and cancels through its buttons', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const c = await render(<ReplaceAllGuard count={47} onConfirm={onConfirm} onCancel={onCancel} />);
    await act(async () => c.querySelector<HTMLButtonElement>('.btn--primary')!.click());
    await act(async () => c.querySelector<HTMLButtonElement>('.btn--secondary')!.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('discloses the atom-span count only when it is non-zero (D6)', async () => {
    const zero = await render(<ReplaceAllGuard count={3} atomSpans={0} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(zero.textContent).not.toContain('run across pictures or embedded items');
    const some = await render(<ReplaceAllGuard count={3} atomSpans={2} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(some.textContent).toContain('2 of these run across pictures or embedded items.');
  });
});
