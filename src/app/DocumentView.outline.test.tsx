// @vitest-environment jsdom
import { vi } from 'vitest';

// Same stub the other DocumentView tests use: DocumentView wires a
// window-level drag/drop listener via getCurrentWebview() on every mount.
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
import type { OutlineEntry } from '../outline/types';

// Borrowed verbatim from DocumentView.toolbar.test.tsx, which mounts the same
// three surfaces: jsdom has neither Range.getClientRects (CodeMirror's measure
// pass) nor document.execCommand (ProseMirror's Safari-shadow-DOM path).
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

const MD = '# Title\n\nhello world\n\n## Section\n\nmore text\n';
const HTML = '<!doctype html>\n<html><body><h1>Title</h1><section><h2>Inside</h2><p>x</p></section></body></html>';
const TXT = 'just some plain text\nwith no headings at all\n';

// Every surface must produce the SAME outline, because it comes from the
// source rather than from whatever projection happens to be showing (spec D2).
const CASES = [
  { label: 'Code view', path: '/tmp/outline.md', text: MD, viewMode: 'code' as const, expect: ['Title', 'Section'] },
  { label: 'Markdown Live', path: '/tmp/outline.md', text: MD, viewMode: 'live' as const, expect: ['Title', 'Section'] },
  { label: 'HTML Live', path: '/tmp/outline.html', text: HTML, viewMode: 'live' as const, expect: ['Title', 'Inside'] },
  { label: 'HTML in Code view', path: '/tmp/outline.html', text: HTML, viewMode: 'code' as const, expect: ['Title', 'Inside'] },
];

function makeDoc(path: string, text: string, viewMode: ViewMode): OpenDoc {
  const session = new DocumentSession({
    path, format: formatForPath(path), meta: { eol: 'lf', hadBom: false }, text,
  });
  return { id: 'outline-test-doc', session, viewMode };
}

async function mount(path: string, text: string, viewMode: ViewMode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const ref = createRef<DocumentViewHandle>();
  const reports: { entries: OutlineEntry[]; activeIndex: number | null }[] = [];
  const root = createRoot(container);
  currentRoot = root;
  await act(async () => root.render(
    <DocumentView
      ref={ref} doc={makeDoc(path, text, viewMode)} effectiveTheme="light" modes={MODES_OFF}
      onSetWritingMode={() => {}} onExport={() => {}}
      onDirtyChange={() => {}} onLiveAvailableChange={() => {}} onError={() => {}} onInfo={() => {}}
      onOutlineChange={(entries, activeIndex) => { reports.push({ entries, activeIndex }); }}
    />,
  ));
  return { ref, reports, last: () => reports[reports.length - 1] };
}

describe('DocumentView — outline reporting', () => {
  for (const c of CASES) {
    it(`reports the same source-derived outline in ${c.label}`, async () => {
      const { last } = await mount(c.path, c.text, c.viewMode);
      expect(last().entries.map((e) => e.text)).toEqual(c.expect);
    });
  }

  it('reports an empty outline for plaintext, rather than not reporting', async () => {
    // The panel shows its own empty state; it is never hidden (spec D4).
    const { last } = await mount('/tmp/outline.txt', TXT, 'code');
    expect(last().entries).toEqual([]);
  });

  it('reports no headings for a Markdown file that has none', async () => {
    const { last } = await mount('/tmp/none.md', 'just a paragraph\n', 'code');
    expect(last().entries).toEqual([]);
  });

  it('exposes a reveal that does not throw on any surface', async () => {
    // The jump itself is covered exactly in codeReveal/pmReveal tests; what
    // this pins is that the handle reaches a live view at all.
    const { ref, last } = await mount('/tmp/outline.md', MD, 'live');
    const entry = last().entries[1];
    expect(() => ref.current?.revealOutlineEntry(entry)).not.toThrow();
  });
});
