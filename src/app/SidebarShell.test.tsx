// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { SidebarShell } from './SidebarShell';

// No testing-library in this project — `createRoot` + `act`, as in
// `Sidebar.test.tsx`.
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

/** Re-render into the same root, for prop-change assertions. */
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

const panes = { files: <div>FILES</div>, outline: <div>OUTLINE</div> };

describe('SidebarShell', () => {
  it('shows no switch when there are no files to switch to (spec D6)', () => {
    const r = render(<SidebarShell hasFiles={false} mode="outline" onSetMode={() => {}} {...panes} />);
    expect(r.querySelector('.sidebar-switch')).toBeNull();
    expect(r.textContent).toContain('OUTLINE');
  });

  it('shows the outline even when the mode says files, if there are no files', () => {
    // A single-document window can never be stuck on an empty Files pane.
    const r = render(<SidebarShell hasFiles={false} mode="files" onSetMode={() => {}} {...panes} />);
    expect(r.textContent).toContain('OUTLINE');
    expect(r.textContent).not.toContain('FILES');
  });

  it('shows the switch when both modes have content (spec D7)', () => {
    const r = render(<SidebarShell hasFiles mode="files" onSetMode={() => {}} {...panes} />);
    expect(r.querySelector('.sidebar-switch')).toBeTruthy();
    expect(r.textContent).toContain('FILES');
  });

  it('switches pane when the mode changes', () => {
    const r = render(<SidebarShell hasFiles mode="files" onSetMode={() => {}} {...panes} />);
    expect(r.textContent).toContain('FILES');
    rerender(<SidebarShell hasFiles mode="outline" onSetMode={() => {}} {...panes} />);
    expect(r.textContent).toContain('OUTLINE');
    expect(r.textContent).not.toContain('FILES');
  });

  it('asks the caller to change mode rather than changing it itself', () => {
    const onSetMode = vi.fn();
    const r = render(<SidebarShell hasFiles mode="files" onSetMode={onSetMode} {...panes} />);
    act(() => { buttonNamed(r, 'Outline').click(); });
    expect(onSetMode).toHaveBeenCalledWith('outline');
  });

  it('marks the showing mode as pressed', () => {
    const r = render(<SidebarShell hasFiles mode="outline" onSetMode={() => {}} {...panes} />);
    expect(buttonNamed(r, 'Outline').getAttribute('aria-pressed')).toBe('true');
    expect(buttonNamed(r, 'Files').getAttribute('aria-pressed')).toBe('false');
  });
});
