// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ExportButton } from './ExportButton';

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

async function render(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  // `createRoot` outside the `act` closure -- see DocumentToolbar.test.tsx:
  // the brief's draft calls it inline inside the closure, where TS narrowing
  // of `container` doesn't reach, and it does not compile (TS2345).
  const root = createRoot(container);
  await act(async () => root.render(node));
  return container!;
}

async function click(el: Element | null) {
  await act(async () => { (el as HTMLButtonElement).click(); });
}

describe('ExportButton', () => {
  it('offers HTML and PDF once opened, and is closed to begin with', async () => {
    const c = await render(<ExportButton onExport={vi.fn()} />);
    expect(c.textContent).not.toContain('PDF');
    await click(c.querySelector('[data-testid="export-button"]'));
    expect(c.textContent).toContain('HTML');
    expect(c.textContent).toContain('PDF');
  });

  it('reports which one was chosen', async () => {
    const onExport = vi.fn();
    const c = await render(<ExportButton onExport={onExport} />);
    await click(c.querySelector('[data-testid="export-button"]'));
    await click(c.querySelector('[data-testid="export-pdf"]'));
    expect(onExport).toHaveBeenCalledWith('pdf');
  });

  it('reports the HTML choice distinctly from the PDF one', async () => {
    // The two options must not collapse onto one handler -- the defect this
    // catches is a copy-paste of the HTML item into the PDF slot, which the
    // test above cannot see on its own if BOTH report 'html'.
    const onExport = vi.fn();
    const c = await render(<ExportButton onExport={onExport} />);
    await click(c.querySelector('[data-testid="export-button"]'));
    await click(c.querySelector('[data-testid="export-html"]'));
    expect(onExport).toHaveBeenCalledWith('html');
  });

  it('closes after a choice, so the next export starts from a shut menu', async () => {
    const c = await render(<ExportButton onExport={vi.fn()} />);
    await click(c.querySelector('[data-testid="export-button"]'));
    await click(c.querySelector('[data-testid="export-html"]'));
    expect(c.textContent).not.toContain('PDF');
  });

  it('dismisses on Escape and on a click outside, like every other popover', async () => {
    // Parity with InsertPopover/TableSizePicker is the point: a menu that
    // only closes by choosing something is a trap, and this app already has
    // an agreed dismissal contract.
    const c = await render(<ExportButton onExport={vi.fn()} />);
    const trigger = c.querySelector('[data-testid="export-button"]');

    await click(trigger);
    // Focus must be INSIDE the menu, and Escape must be raised from wherever
    // focus really is. Dispatching straight at the menu element instead was
    // how the first version of this test passed against a component where
    // Escape did nothing at all: the handler lives on the menu, so a keydown
    // from the still-focused trigger never bubbles through it.
    expect(document.activeElement, 'focus did not move into the menu')
      .toBe(c.querySelector('[data-testid="export-html"]'));
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(c.textContent, 'Escape did not dismiss').not.toContain('PDF');
    expect(document.activeElement, 'Escape did not return focus to the trigger').toBe(trigger);

    await click(c.querySelector('[data-testid="export-button"]'));
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(c.textContent, 'outside click did not dismiss').not.toContain('PDF');
  });
});
