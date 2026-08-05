// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { TableSizePicker } from './TableSizePicker';

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

// A fake trigger rect (jsdom's real getBoundingClientRect always returns
// zeroes -- see the positioning tests below for why this is still a
// meaningful thing to inject).
const rect = (left: number, width = 32) =>
  ({ left, right: left + width, top: 40, bottom: 68, width, height: 28 }) as DOMRect;
const DEFAULT_RECT = rect(100);

async function render(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return { container: container!, root };
}

describe('TableSizePicker', () => {
  it('renders an 8x8 grid of cells', async () => {
    const { container } = await render(<TableSizePicker triggerRect={DEFAULT_RECT} onSelect={() => {}} onCancel={() => {}} />);
    expect(container.querySelectorAll('.tsp-cell').length).toBe(64);
  });

  it('hovering a cell highlights the top-left rectangle and updates the caption', async () => {
    const { container } = await render(<TableSizePicker triggerRect={DEFAULT_RECT} onSelect={() => {}} onCancel={() => {}} />);
    const cells = Array.from(container.querySelectorAll('.tsp-cell'));
    // cell at row 3, col 4 (0-based index (3-1)*8 + (4-1) = 19)
    await act(async () => { cells[19].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(container.querySelector('.tsp-caption')?.textContent).toBe('3 × 4');
    expect(container.querySelectorAll('.tsp-cell.tsp-on').length).toBe(3 * 4);
  });

  it('clicking a cell calls onSelect(rows, cols)', async () => {
    const onSelect = vi.fn();
    const { container } = await render(<TableSizePicker triggerRect={DEFAULT_RECT} onSelect={onSelect} onCancel={() => {}} />);
    const cells = Array.from(container.querySelectorAll('.tsp-cell'));
    await act(async () => { cells[19].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(onSelect).toHaveBeenCalledWith(3, 4);
  });

  it('Escape calls onCancel', async () => {
    const onCancel = vi.fn();
    const { container } = await render(<TableSizePicker triggerRect={DEFAULT_RECT} onSelect={() => {}} onCancel={onCancel} />);
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    await act(async () => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onCancel).toHaveBeenCalled();
  });
});

// jsdom's getBoundingClientRect() always returns 0x0/at-origin regardless of
// CSS, so the picker's own measured size is always {width: 0, height: 0}
// here -- a jsdom limitation, not something these tests can control (same
// caveat as InsertPopover.test.tsx). What they CAN meaningfully verify: the
// position that reaches the DOM is derived from the *injected* triggerRect
// via the real anchorTo (not a mocked stand-in, and not the old
// fixed-to-the-ribbon position with no left at all).
describe('TableSizePicker positioning (anchorTo)', () => {
  it('positions beneath the ⊞ control, not at its old static (no-left) position', async () => {
    // A control positioned well to the right of the ribbon.
    const { container } = await render(
      <TableSizePicker triggerRect={rect(500)} onSelect={() => {}} onCancel={() => {}} />,
    );
    const picker = container.querySelector('.table-size-picker') as HTMLElement;
    // Floating width is 0 in jsdom, so anchorTo centres it exactly on the
    // trigger's centre: 500 + 32/2 = 516.
    expect(picker.style.left).toBe('516px');
    expect(picker.style.left).not.toBe(''); // the old rule set no `left` at all
  });

  it('a control further right produces a different position than one further left', async () => {
    // Directly guards against the pre-existing bug: two different triggers
    // must not collapse onto the same static position.
    const leftEl = (await render(<TableSizePicker triggerRect={rect(50)} onSelect={() => {}} onCancel={() => {}} />)).container;
    const leftPos = (leftEl.querySelector('.table-size-picker') as HTMLElement).style.left;
    leftEl.remove(); // this test renders twice; don't leak the first mount into the DOM
    const rightEl = (await render(<TableSizePicker triggerRect={rect(700)} onSelect={() => {}} onCancel={() => {}} />)).container;
    const rightPos = (rightEl.querySelector('.table-size-picker') as HTMLElement).style.left;
    expect(leftPos).not.toBe(rightPos);
  });
});
