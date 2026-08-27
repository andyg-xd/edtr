// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useSidebarOpen } from './sidebarOpenState';

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
});
