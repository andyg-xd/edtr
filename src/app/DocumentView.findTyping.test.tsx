// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, createRef } from 'react';
import type { EditorView as PMView } from 'prosemirror-view';
import type { EditorView as CMView } from '@codemirror/view';
import { TextSelection } from 'prosemirror-state';
import { DocumentView, type DocumentViewHandle } from './DocumentView';
import { DocumentSession } from '../files/documentSession';
import { formatForPath } from '../files/fileTypes';
import type { ViewMode } from '../files/openDocuments';
import { MODES_OFF } from '../settings/writingModes';

// Every surface's `reveal` is counted, and the editor each surface drives is
// captured, so a test can type into the document the way a person does.
const spy = vi.hoisted(() => ({ reveals: 0, pm: null as unknown, cm: null as unknown }));
vi.mock('../find/codeSurface', async (orig) => {
  const actual = await orig<typeof import('../find/codeSurface')>();
  return {
    ...actual,
    codeSurface: (view: CMView) => {
      spy.cm = view;
      const s = actual.codeSurface(view);
      return { ...s, reveal: (m: Parameters<typeof s.reveal>[0]) => { spy.reveals++; s.reveal(m); } };
    },
  };
});
vi.mock('../find/pmSurface', async (orig) => {
  const actual = await orig<typeof import('../find/pmSurface')>();
  return {
    ...actual,
    pmSurface: (view: PMView) => {
      spy.pm = view;
      const s = actual.pmSurface(view);
      return { ...s, reveal: (m: Parameters<typeof s.reveal>[0]) => { spy.reveals++; s.reveal(m); } };
    },
  };
});
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => new Promise<() => void>(() => {}) }),
}));
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function (this: Range) { return [] as unknown as DOMRectList; };
  Range.prototype.getBoundingClientRect = function (this: Range) { return new DOMRect(); };
}
if (typeof document.execCommand !== 'function') document.execCommand = () => false;

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;
afterEach(async () => {
  if (root) { await act(async () => root!.unmount()); root = null; }
  container?.remove();
  container = null;
  spy.reveals = 0; spy.pm = null; spy.cm = null;
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 200)); });

async function mount(path: string, text: string, viewMode: ViewMode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const ref = createRef<DocumentViewHandle>();
  const session = new DocumentSession({ path, format: formatForPath(path), meta: { eol: 'lf', hadBom: false }, text });
  await act(async () => root!.render(
    <DocumentView
      ref={ref} doc={{ id: 'd', session, viewMode }} effectiveTheme="light" modes={MODES_OFF}
      onSetWritingMode={() => {}} onExport={() => {}}
      onDirtyChange={() => {}} onLiveAvailableChange={() => {}} onError={() => {}} onInfo={() => {}}
    />,
  ));
  return { ref, session };
}

async function search(ref: React.RefObject<DocumentViewHandle | null>, query: string) {
  await act(async () => { ref.current!.openReplace(); });
  const el = container!.querySelector<HTMLInputElement>('.find-input')!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(el, query); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await settle();
}

/** A keystroke in the document at the very start, where no match is. */
async function typeAtStart(viewMode: ViewMode) {
  await act(async () => {
    if (viewMode === 'code') {
      const v = spy.cm as CMView;
      v.dispatch({ selection: { anchor: 0 } });
      v.dispatch({ changes: { from: 0, insert: 'X' }, selection: { anchor: 1 }, userEvent: 'input.type' });
    } else {
      const v = spy.pm as PMView;
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1)));
      v.dispatch(v.state.tr.insertText('X'));
    }
  });
  await settle();
}

describe.each([
  { label: 'Code view', path: '/tmp/t.md', text: 'start here. cat one, cat two, cat three\n', viewMode: 'code' as const },
  { label: 'Markdown Live', path: '/tmp/t.md', text: 'start here. cat one, cat two, cat three\n', viewMode: 'live' as const },
  { label: 'HTML Live', path: '/tmp/t.html', text: '<!doctype html><html><body><p>start here. cat one, cat two, cat three</p></body></html>', viewMode: 'live' as const },
])('typing in the document with find open — $label', ({ path, text, viewMode }) => {
  it('does not move the caret to a match', async () => {
    const { ref } = await mount(path, text, viewMode);
    await search(ref, 'cat');
    expect(spy.reveals).toBeGreaterThan(0); // the search itself reveals, as it should
    const before = spy.reveals;

    await typeAtStart(viewMode);
    expect(spy.reveals).toBe(before);
    if (viewMode === 'code') expect((spy.cm as CMView).state.selection.main.head).toBe(1);
    else expect((spy.pm as PMView).state.selection.from).toBe(2);
  });

  it('still reveals when the person navigates afterwards', async () => {
    const { ref } = await mount(path, text, viewMode);
    await search(ref, 'cat');
    await typeAtStart(viewMode);
    const before = spy.reveals;
    await act(async () => { ref.current!.findNext(); });
    await settle();
    expect(spy.reveals).toBeGreaterThan(before);
  });
  it('Replace still walks on and reveals the next match, though it edits the document', async () => {
    const { ref } = await mount(path, text, viewMode);
    await search(ref, 'cat');
    await typeAtStart(viewMode); // leaves the "edited since find" state set
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    const field = container!.querySelector<HTMLInputElement>('.find-replace-input')!;
    await act(async () => { setter.call(field, 'dog'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    const before = spy.reveals;
    await act(async () => { container!.querySelector<HTMLButtonElement>('.find-replace')!.click(); });
    await settle();
    expect(spy.reveals).toBeGreaterThan(before);
  });
});
