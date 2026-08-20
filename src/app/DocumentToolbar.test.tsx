// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { DocumentToolbar } from './DocumentToolbar';
import { MODES_OFF } from '../settings/writingModes';

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

async function render(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  // `createRoot` called here, not inside the `act` closure below: the brief's
  // original draft called it inline inside the async arrow passed to `act`,
  // where TS's control-flow narrowing of `container` (HTMLDivElement | null)
  // doesn't cross the closure boundary, so `container` was still typed as
  // possibly-null there — TS2345. Narrowing the value into a local `root`
  // before the closure sidesteps that instead of asserting past it.
  const root = createRoot(container);
  await act(async () => root.render(node));
  return container!;
}

describe('DocumentToolbar', () => {
  it('shows the document actions even with NO formatting zone (Code view)', async () => {
    // The whole reason this component exists: Code view has no ribbon, and
    // the writing modes work there.
    const c = await render(
      <DocumentToolbar formatting={null} modes={MODES_OFF} onSetMode={() => {}} onExport={() => {}} />,
    );
    expect(c.querySelector('.mode-controls')).not.toBeNull();
    expect(c.querySelector('[data-testid="export-button"]')).not.toBeNull();
  });

  it('shows the formatting zone when given one', async () => {
    const c = await render(
      <DocumentToolbar
        formatting={<div data-testid="fmt" />}
        modes={MODES_OFF} onSetMode={() => {}} onExport={() => {}}
      />,
    );
    expect(c.querySelector('[data-testid="fmt"]')).not.toBeNull();
    expect(c.querySelector('.mode-controls')).not.toBeNull();
  });

  it('renders nothing in the formatting zone when null (Live-only formatting stays out of Code view)', async () => {
    // The complement of the two tests above: neither test so far actually
    // proves the formatting zone is EMPTY when null is passed -- a component
    // that ignored `formatting` and always rendered some hardcoded node would
    // still pass both. This asserts the zone is truly empty for `null`.
    const c = await render(
      <DocumentToolbar formatting={null} modes={MODES_OFF} onSetMode={() => {}} onExport={() => {}} />,
    );
    expect(c.querySelector('.doc-toolbar-formatting')?.childElementCount).toBe(0);
  });

  it("wires the Export button's chosen kind through to onExport", async () => {
    // Task 6 asserted this against the placeholder, where the trigger called
    // `onExport` directly. Task 7 put a menu behind it, so the trigger now
    // only opens; the kind is reported by the item. The INTENT under test is
    // unchanged -- that the toolbar's prop actually reaches the control --
    // which is why this is retargeted rather than deleted.
    const onExport = vi.fn();
    const c = await render(
      <DocumentToolbar formatting={null} modes={MODES_OFF} onSetMode={() => {}} onExport={onExport} />,
    );
    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="export-button"]')!.click();
    });
    expect(onExport, 'the trigger must only open the menu').not.toHaveBeenCalled();
    await act(async () => {
      c.querySelector<HTMLButtonElement>('[data-testid="export-html"]')!.click();
    });
    expect(onExport).toHaveBeenCalledWith('html');
  });
});
