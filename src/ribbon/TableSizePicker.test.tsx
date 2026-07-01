// @vitest-environment jsdom
// @ts-expect-error — configure React 18 act() for jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { TableSizePicker } from './TableSizePicker';

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

async function render(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return { container: container!, root };
}

describe('TableSizePicker', () => {
  it('renders an 8x8 grid of cells', async () => {
    const { container } = await render(<TableSizePicker onSelect={() => {}} onCancel={() => {}} />);
    expect(container.querySelectorAll('.tsp-cell').length).toBe(64);
  });

  it('hovering a cell highlights the top-left rectangle and updates the caption', async () => {
    const { container } = await render(<TableSizePicker onSelect={() => {}} onCancel={() => {}} />);
    const cells = Array.from(container.querySelectorAll('.tsp-cell'));
    // cell at row 3, col 4 (0-based index (3-1)*8 + (4-1) = 19)
    await act(async () => { cells[19].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); });
    expect(container.querySelector('.tsp-caption')?.textContent).toBe('3 × 4');
    expect(container.querySelectorAll('.tsp-cell.tsp-on').length).toBe(3 * 4);
  });

  it('clicking a cell calls onSelect(rows, cols)', async () => {
    const onSelect = vi.fn();
    const { container } = await render(<TableSizePicker onSelect={onSelect} onCancel={() => {}} />);
    const cells = Array.from(container.querySelectorAll('.tsp-cell'));
    await act(async () => { cells[19].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(onSelect).toHaveBeenCalledWith(3, 4);
  });

  it('Escape calls onCancel', async () => {
    const onCancel = vi.fn();
    const { container } = await render(<TableSizePicker onSelect={() => {}} onCancel={onCancel} />);
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onCancel).toHaveBeenCalled();
  });
});
