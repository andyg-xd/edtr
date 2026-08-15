// @vitest-environment jsdom
import { vi } from 'vitest';

// Same stub DocumentView.find.test.tsx uses: DocumentView unconditionally
// wires a window-level drag/drop listener via getCurrentWebview() on every
// mount, unrelated to this file's concern but real enough that jsdom (no
// __TAURI_INTERNALS__) throws reaching it.
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => new Promise<() => void>(() => {}) }),
}));

import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, createRef } from 'react';
import { DocumentView, type DocumentViewHandle } from './DocumentView';
import { MODES_OFF } from '../settings/writingModes';
import { DocumentSession } from '../files/documentSession';
import { formatForPath } from '../files/fileTypes';
import type { OpenDoc, ViewMode } from '../files/openDocuments';

// jsdom has no Range.getClientRects (CodeMirror's measure pass needs it) and
// no document.execCommand (ProseMirror's Safari-shadow-DOM selection path
// needs it, reached because jsdom's navigator.vendor makes ProseMirror think
// it's Safari) — both borrowed verbatim from DocumentView.find.test.tsx,
// which mounts the same three surfaces this file does.
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function (this: Range) { return [] as unknown as DOMRectList; };
  Range.prototype.getBoundingClientRect = function (this: Range) { return new DOMRect(); };
}
if (typeof document.execCommand !== 'function') {
  document.execCommand = () => false;
}

let container: HTMLDivElement | null = null;
let currentRoot: ReturnType<typeof createRoot> | null = null;
afterEach(async () => {
  if (currentRoot) { await act(async () => currentRoot!.unmount()); currentRoot = null; }
  container?.remove();
  container = null;
});

const MD = '# Title\n\nhello world\n';
const HTML = '<!doctype html>\n<html><body><h1>Title</h1><p>hello world</p></body></html>';

/**
 * The reason this task exists at all (see DocumentToolbar.tsx's doc comment):
 * `RibbonView` only mounts in the two Live branches, so a test that only
 * covers one view mode cannot tell "the actions zone is unconditional" apart
 * from "it happens to be reachable from whichever branch RibbonView renders
 * in." Three cases, matching DocumentView.find.test.tsx's CASES shape, so
 * Code view, Markdown Live and HTML Live are each exercised through the real
 * DocumentView branch that produces them, not a hand-built stand-in.
 */
const CASES = [
  { label: 'Code view', path: '/tmp/toolbar.md', text: MD, viewMode: 'code' as const },
  { label: 'Markdown Live', path: '/tmp/toolbar.md', text: MD, viewMode: 'live' as const },
  { label: 'HTML Live', path: '/tmp/toolbar.html', text: HTML, viewMode: 'live' as const },
];

function makeDoc(path: string, text: string, viewMode: ViewMode): OpenDoc {
  const session = new DocumentSession({
    path, format: formatForPath(path), meta: { eol: 'lf', hadBom: false }, text,
  });
  return { id: 'toolbar-test-doc', session, viewMode };
}

async function mount(path: string, text: string, viewMode: ViewMode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const ref = createRef<DocumentViewHandle>();
  const doc = makeDoc(path, text, viewMode);
  const root = createRoot(container);
  currentRoot = root;
  await act(async () => root.render(
    <DocumentView
      ref={ref} doc={doc} effectiveTheme="light" modes={MODES_OFF}
      onSetWritingMode={() => {}} onExport={() => {}}
      onDirtyChange={() => {}} onLiveAvailableChange={() => {}} onError={() => {}} onInfo={() => {}}
    />,
  ));
  return container!;
}

describe('DocumentView — persistent document-actions zone', () => {
  for (const { label, path, text, viewMode } of CASES) {
    it(`shows the document actions in ${label}`, async () => {
      const c = await mount(path, text, viewMode);
      expect(c.querySelector('.doc-toolbar-actions'), `${label}: no .doc-toolbar-actions`).not.toBeNull();
      expect(c.querySelector('.mode-controls'), `${label}: no mode controls`).not.toBeNull();
      expect(c.querySelector('[data-testid="export-button"]'), `${label}: no export button`).not.toBeNull();
    });
  }

  it('leaves the formatting zone empty in Code view (no RibbonView to strand the modes behind)', async () => {
    const c = await mount('/tmp/toolbar.md', MD, 'code');
    expect(c.querySelector('.doc-toolbar-formatting')?.childElementCount).toBe(0);
    expect(c.querySelector('.ribbon')).toBeNull();
  });

  it('fills the formatting zone with the ribbon in Markdown Live', async () => {
    const c = await mount('/tmp/toolbar.md', MD, 'live');
    expect(c.querySelector('.doc-toolbar-formatting .ribbon')).not.toBeNull();
  });
});
