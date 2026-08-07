// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, createRef } from 'react';
import { DocumentView, type DocumentViewHandle } from './DocumentView';
import { DocumentSession } from '../files/documentSession';
import type { OpenDoc, ViewMode } from '../files/openDocuments';

// DocumentView unconditionally wires a window-level drag/drop listener via
// getCurrentWebview() (image-drop support) on every mount — nothing to do with
// find, but real enough that jsdom (no __TAURI_INTERNALS__) throws reaching it.
// Stub it exactly the way the drop feature already treats "no webview": an
// onDragDropEvent that never resolves the app's own listener.
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => new Promise<() => void>(() => {}) }),
}));

// jsdom implements Element.getClientRects but not Range.getClientRects (real
// browsers have both). CodeMirror's periodic text-measurement pass calls the
// Range version and, with a doc mounted for the debounce/settle waits below,
// actually gets scheduled during the test — polyfill it as empty so that pass
// no-ops instead of throwing from inside a requestAnimationFrame callback.
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function (this: Range) { return [] as unknown as DOMRectList; };
  Range.prototype.getBoundingClientRect = function (this: Range) { return new DOMRect(); };
}

let container: HTMLDivElement | null = null;
let currentRoot: ReturnType<typeof createRoot> | null = null;
afterEach(async () => {
  // Unmount before removing the node: CodeView's cleanup effect calls
  // view.destroy(), which cancels CodeMirror's internal measure rAF loop —
  // without it, that loop keeps firing against a detached container and
  // throws in later tests (jsdom has no getClientRects on a removed node).
  if (currentRoot) { await act(async () => currentRoot!.unmount()); currentRoot = null; }
  container?.remove();
  container = null;
});

const MD = '# Title\n\nhello world, hello again\n';

/** Build a bare OpenDoc the same way useOpenDocuments.test.tsx builds a session
 * — `new DocumentSession(...)` directly — rather than inventing a new factory. */
function makeDoc(text: string, viewMode: ViewMode): OpenDoc {
  const session = new DocumentSession({
    path: '/tmp/find.md', format: 'markdown', meta: { eol: 'lf', hadBom: false }, text,
  });
  return { id: 'find-test-doc', session, viewMode };
}

async function mount(text: string, viewMode: 'code' | 'live') {
  container = document.createElement('div');
  document.body.appendChild(container);
  const ref = createRef<DocumentViewHandle>();
  const doc = makeDoc(text, viewMode);
  const root = createRoot(container);
  currentRoot = root;
  await act(async () => root.render(
    <DocumentView
      ref={ref} doc={doc} effectiveTheme="light"
      onDirtyChange={() => {}} onLiveAvailableChange={() => {}} onError={() => {}}
    />,
  ));
  return { ref, doc, container: container! };
}

const bar = (c: HTMLElement) => c.querySelector('.find-bar');
const field = (c: HTMLElement) => c.querySelector<HTMLInputElement>('.find-input')!;

async function type(c: HTMLElement, text: string) {
  const el = field(c);
  // Go through the prototype's native value setter rather than assigning
  // el.value -- React's per-node value tracker absorbs a direct write and then
  // sees no change on the 'input' event, so onChange never fires. Same bypass
  // as RibbonView.test.tsx / InsertPopover.test.tsx / FindBar.test.tsx.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Let the 120ms debounce fire.
  await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
}

describe.each(['code', 'live'] as const)('DocumentView find — %s view', (viewMode) => {
  it('is closed until ⌘F, then opens above the editor', async () => {
    const { ref, container: c } = await mount(MD, viewMode);
    expect(bar(c)).toBeNull();
    await act(async () => { ref.current!.openFind(); });
    expect(bar(c)).toBeTruthy();
    // The bar precedes the editor in DOM order — that is what shifts the
    // canvas down rather than covering text.
    const editor = c.querySelector('.code-view, .live-view')!;
    expect(bar(c)!.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('counts matches and navigates them', async () => {
    const { ref, container: c } = await mount(MD, viewMode);
    await act(async () => { ref.current!.openFind(); });
    await type(c, 'hello');
    expect(c.querySelector('.find-count')?.textContent).toBe('1/2');
    await act(async () => { ref.current!.findNext(); });
    expect(c.querySelector('.find-count')?.textContent).toBe('2/2');
    await act(async () => { ref.current!.findNext(); });
    expect(c.querySelector('.find-count')?.textContent).toBe('1/2'); // wraps
  });

  it('says No results in plain language', async () => {
    const { ref, container: c } = await mount(MD, viewMode);
    await act(async () => { ref.current!.openFind(); });
    await type(c, 'zebra');
    expect(c.querySelector('.find-count')?.textContent).toBe('No results');
  });

  it('NEVER dirties the document — searching, navigating, closing, all of it', async () => {
    // THE load-bearing test (design §6). If this ever fails, stop: find has
    // started writing to files.
    const onDirtyChange = vi.fn();
    const { ref, doc, container: c } = await mount(MD, viewMode);
    await act(async () => { ref.current!.openFind(); });
    await type(c, 'hello');
    await act(async () => { ref.current!.findNext(); });
    await act(async () => { ref.current!.findPrev(); });
    await act(async () => { field(c).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(doc.session.text).toBe(MD);
    expect(doc.session.isDirty()).toBe(false);
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  });

  it('closes on Escape and clears its highlights', async () => {
    const { ref, container: c } = await mount(MD, viewMode);
    await act(async () => { ref.current!.openFind(); });
    await type(c, 'hello');
    await act(async () => { field(c).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(bar(c)).toBeNull();
    expect(c.querySelectorAll('.cm-edtr-find, .edtr-find').length).toBe(0);
  });

  it('does not re-scan in a loop when highlighting', async () => {
    // Highlighting dispatches a transaction. If that fed the recompute, this
    // would never settle. A settling render count is the proof.
    const { ref, container: c } = await mount(MD, viewMode);
    await act(async () => { ref.current!.openFind(); });
    await type(c, 'hello');
    const first = c.querySelector('.find-count')?.textContent;
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(c.querySelector('.find-count')?.textContent).toBe(first);
  });
});
