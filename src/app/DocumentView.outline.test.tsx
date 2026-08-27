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
    //
    // NOTE: `not.toThrow()` passes just as happily when the reveal silently
    // does nothing, which is exactly how B2 escaped 1228 tests. The three
    // tests below are the ones with teeth; this one is kept only because a
    // throw and a no-op are different failures worth telling apart.
    const { ref, last } = await mount('/tmp/outline.md', MD, 'live');
    const entry = last().entries[1];
    expect(() => ref.current?.revealOutlineEntry(entry)).not.toThrow();
  });

  // B2, found by the owner's GUI pass 2026-08-26. `useImperativeHandle` left
  // `showLive`/`liveView`/`codeView` out of its dependency array while
  // `revealOutlineEntry` closed over all three, so the handle captured
  // `liveView === null` from the first render and the reveal hit a silent
  // no-op guard. Any later re-render that changed one of the five listed
  // callbacks refreshed the closure -- which is why closing and reopening the
  // sidebar "fixed" it, and why it read as intermittent.
  //
  // The assertion is the MARKED ENTRY MOVING, not the absence of a throw: a
  // reveal that no-ops leaves the caret where it was, so the active index
  // never reaches the entry we asked for. Selection-only transactions already
  // re-report the outline (`handleLiveStateChange` -> `bumpRibbon` ->
  // `countVersion`), so this rides existing wiring rather than adding any.
  // HTML with both headings at TOP level. `HTML` nests its second heading in a
  // <section>, and a caret inside a container resolves to the CONTAINER's
  // source offset (`caretSourceOffsetInPm` says so in its own doc comment) --
  // which starts before the heading, so `activeEntryIndex` marks the previous
  // entry. That is a real and separate defect, found by this test on
  // 2026-08-26 and fixed in Task 3, where live-derived entries carry exact PM
  // anchors instead of inexact source offsets. Using it here would conflate
  // that defect with B2 and leave this test red for the wrong reason.
  const HTML_TOP = '<!doctype html>\n<html><body><h1>Title</h1><p>a</p><h2>Second</h2><p>b</p></body></html>';

  const FIRST_CALL_CASES = [
    { label: 'Markdown Live', path: '/tmp/outline.md', text: MD, viewMode: 'live' as const },
    { label: 'HTML Live', path: '/tmp/outline.html', text: HTML_TOP, viewMode: 'live' as const },
    { label: 'Code view', path: '/tmp/outline.md', text: MD, viewMode: 'code' as const },
  ];

  for (const c of FIRST_CALL_CASES) {
    it(`reveals on the FIRST call in ${c.label}, with no re-render to refresh the handle`, async () => {
      const { ref, reports, last } = await mount(c.path, c.text, c.viewMode);
      const target = last().entries[1];
      expect(target).toBeDefined();
      // Guard the assertion against passing for the wrong reason: if the
      // caret already sat in the target section, "it moved" proves nothing.
      expect(last().activeIndex).not.toBe(1);

      const before = reports.length;
      await act(async () => { ref.current?.revealOutlineEntry(target); });

      expect(reports.length).toBeGreaterThan(before);
      expect(last().activeIndex).toBe(1);
    });
  }

  // The defect found by Task 1's test on 2026-08-26 and deferred to Task 3,
  // where the fix falls out of A5's live-derived entries.
  //
  // A source-derived entry cannot answer this: a caret inside a <section> has
  // no source range of its own, so the best available offset is the
  // CONTAINER's — which starts before the <h2> it holds, so `activeEntryIndex`
  // marks the PREVIOUS heading. Invisible in Markdown, where every heading is
  // top-level, which is why the GUI pass walked A4 and saw nothing wrong.
  //
  // Only live-derived entries can pass this, so it doubles as proof that
  // DocumentView really is deriving from the live document in a Live view.
  it('marks a heading nested inside a container, not the one before it', async () => {
    const { ref, last } = await mount('/tmp/outline.html', HTML, 'live');
    expect(last().entries.map((e) => e.text)).toEqual(['Title', 'Inside']);
    expect(last().activeIndex).not.toBe(1);

    await act(async () => { ref.current?.revealOutlineEntry(last().entries[1]); });

    expect(last().activeIndex).toBe(1);
  });
});
