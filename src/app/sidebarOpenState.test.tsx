// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';

// The window-growth call (6c-iv-b). Mocked rather than left to reject, so the
// test can assert it FIRES — a `.catch(() => {})` swallowing a real rejection
// looks identical to a call that was never wired at all.
const invokeMock = vi.fn((_cmd: string, _args?: unknown) => Promise.resolve('grew-left'));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useSidebarOpen } from './sidebarOpenState';

beforeEach(() => { invokeMock.mockClear(); });

let container: HTMLDivElement | null = null;
let currentRoot: ReturnType<typeof createRoot> | null = null;
afterEach(async () => {
  if (currentRoot) { await act(async () => currentRoot!.unmount()); currentRoot = null; }
  container?.remove();
  container = null;
});

// A trivial host so the hook can be driven without mounting EditorWindow,
// which would need the whole Tauri surface mocked to say anything at all.
function Host({ hasFiles }: { hasFiles: boolean }) {
  const [open, toggle] = useSidebarOpen(hasFiles);
  return <button data-open={open ? 'yes' : 'no'} onClick={toggle}>x</button>;
}

async function render(hasFiles: boolean) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  currentRoot = root;
  await act(async () => root.render(<Host hasFiles={hasFiles} />));
  return {
    isOpen: () => container!.querySelector('button')!.getAttribute('data-open') === 'yes',
    setHasFiles: async (v: boolean) => { await act(async () => root.render(<Host hasFiles={v} />)); },
    click: async () => { await act(async () => { container!.querySelector('button')!.click(); }); },
  };
}

describe('useSidebarOpen', () => {
  it('starts closed for a single document', async () => {
    const h = await render(false);
    expect(h.isOpen()).toBe(false);
  });

  it('starts open when the window already has files at mount', async () => {
    const h = await render(true);
    expect(h.isOpen()).toBe(true);
  });

  // THE DEFECT (owner's GUI pass, 2026-08-26). A folder arrives asynchronously
  // from `read_folder`, so at first render `hasFiles` is false. `useState`
  // reads its argument only on that first render, so the sidebar started
  // closed and nothing ever reopened it — the intended behaviour was written
  // and then silently never happened.
  it('opens when the folder arrives AFTER the first render', async () => {
    const h = await render(false);
    expect(h.isOpen()).toBe(false);
    await h.setHasFiles(true);
    expect(h.isOpen()).toBe(true);
  });

  it('never undoes a deliberate close (D-3: the toggle must stay meaningful)', async () => {
    const h = await render(true);
    await h.click();
    expect(h.isOpen()).toBe(false);
    // A doc opening or closing must not spring it back open.
    await h.setHasFiles(false);
    await h.setHasFiles(true);
    expect(h.isOpen()).toBe(false);
  });

  it('keeps a deliberate open too', async () => {
    const h = await render(false);
    await h.click();
    expect(h.isOpen()).toBe(true);
    await h.setHasFiles(true);
    expect(h.isOpen()).toBe(true);
  });
  it('does NOT resize the window on mount', async () => {
    // A window that starts with its sidebar open was built at that size. Growing
    // it again here would widen every folder window by 200px on every open.
    await render(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('asks the window to grow when the sidebar opens, and to shrink when it closes', async () => {
    const h = await render(false);
    await h.click();
    expect(invokeMock).toHaveBeenCalledWith('set_sidebar_window_growth', { open: true });

    invokeMock.mockClear();
    await h.click();
    expect(invokeMock).toHaveBeenCalledWith('set_sidebar_window_growth', { open: false });
  });

  it('resizes on the AUTOMATIC open too, not just a click', async () => {
    // The folder-arrives path. Wiring the growth to the button instead of to
    // this state would have left this case silently not growing.
    const h = await render(false);
    await h.setHasFiles(true);
    expect(invokeMock).toHaveBeenCalledWith('set_sidebar_window_growth', { open: true });
  });

  it('still toggles when the window refuses to resize', async () => {
    // Degrades to the pre-6c-iv-b behaviour: the pane absorbs the width. The
    // sidebar must never be held hostage by a window operation.
    invokeMock.mockImplementationOnce(() => Promise.reject(new Error('no monitor')));
    const h = await render(false);
    await h.click();
    expect(h.isOpen()).toBe(true);
  });
});
