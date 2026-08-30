// @vitest-environment jsdom
//
// The outline must not re-parse the document when only the caret moved.
//
// `outlineEntries` used to ride `countVersion`, which carries the Code caret's
// line and column because the WORD COUNT is selection-aware. The outline is
// not -- headings do not move when the caret does -- so every arrow key ran
// `buildOutline` -> `parse()` over the whole document.
//
// MEASURED 2026-08-29, against `countText` at the same sizes in the same run:
//
//     200 lines  ( 13k chars)   7.92 ms   vs  countText 0.03 ms   276x
//   5 000 lines  (344k chars) 185.77 ms   vs  countText 0.71 ms   263x
//  20 000 lines  (1.4M chars) 758.59 ms   vs  countText 2.57 ms   295x
//
// This test counts calls rather than measuring time: a timing assertion in
// jsdom would be flaky and would not say WHY it got slow. A call count says
// exactly what regressed -- someone putting a caret-bearing key back in the
// dependency array.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createRef } from 'react';
import { EditorView } from '@codemirror/view';

// jsdom implements Element.getClientRects but not the Range version, which
// CodeMirror's text-measurement pass calls. Same polyfill DocumentView's find
// tests carry, for the same reason.
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function (this: Range) { return [] as unknown as DOMRectList; };
  Range.prototype.getBoundingClientRect = function (this: Range) { return new DOMRect(); };
}

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));

const buildOutlineSpy = vi.fn();
vi.mock('../outline/outlineModel', async (importOriginal) => {
  const real = await importOriginal<typeof import('../outline/outlineModel')>();
  return {
    ...real,
    buildOutline: (...args: Parameters<typeof real.buildOutline>) => {
      buildOutlineSpy(...args);
      return real.buildOutline(...args);
    },
  };
});

import { DocumentView, type DocumentViewHandle } from './DocumentView';
import { DocumentSession } from '../files/documentSession';
import { formatForPath } from '../files/fileTypes';
import { MODES_OFF } from '../settings/writingModes';
import type { OpenDoc } from '../files/openDocuments';

const SRC = ['# One', '', 'Body text here.', '', '## Two', '', 'More body text.', ''].join('\n');

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => buildOutlineSpy.mockClear());
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

async function mountCodeView(text: string, outlineVisible = true) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const path = '/tmp/outline-cost.md';
  const session = new DocumentSession({
    path, format: formatForPath(path), meta: { eol: 'lf', hadBom: false }, text,
  });
  const doc: OpenDoc = { id: 'd1', session, viewMode: 'code' };
  const ref = createRef<DocumentViewHandle>();
  root = createRoot(container);
  await act(async () => root!.render(
    <DocumentView
      ref={ref} doc={doc} effectiveTheme="light" modes={MODES_OFF}
      onSetWritingMode={() => {}} onExport={() => {}}
      onDirtyChange={() => {}} onLiveAvailableChange={() => {}}
      onError={() => {}} onInfo={() => {}}
      outlineVisible={outlineVisible}
    />,
  ));
  const cm = EditorView.findFromDOM(container.querySelector('.cm-editor')!)!;
  return { cm, session };
}

describe('the outline does not re-parse on a caret move', () => {
  it('re-parses when the TEXT changes, once the burst settles', async () => {
    const { cm } = await mountCodeView(SRC);
    const before = buildOutlineSpy.mock.calls.length;
    expect(before).toBeGreaterThan(0); // opening the panel parses immediately

    // A real document change, the same shape CodeView reports upward.
    await act(async () => {
      cm.dispatch({ changes: { from: SRC.length, insert: '\n### Three\n' } });
    });
    // Nothing yet: the parse waits for the typing burst to end. This is the
    // whole point of the debounce -- a full parse per character is what made a
    // large file unusable.
    expect(buildOutlineSpy.mock.calls.length).toBe(before);

    await act(async () => { await new Promise((r) => setTimeout(r, 260)); });

    // The probe half: without this, the assertions above could pass simply
    // because nothing ever calls buildOutline in this harness.
    expect(buildOutlineSpy.mock.calls.length).toBeGreaterThan(before);
  });

  it('does not parse AT ALL while the outline panel is closed', async () => {
    // The larger of the two wins: the panel is usually shut, and the parse ran
    // regardless of whether anyone could see the result.
    const { cm } = await mountCodeView(SRC, false);
    expect(buildOutlineSpy.mock.calls.length).toBe(0);

    await act(async () => {
      cm.dispatch({ changes: { from: SRC.length, insert: '\n### Three\n' } });
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 260)); });

    expect(buildOutlineSpy.mock.calls.length).toBe(0);
  });

  it('does NOT re-parse when only the selection moves', async () => {
    const { cm } = await mountCodeView(SRC);
    const before = buildOutlineSpy.mock.calls.length;

    // Selection-only transactions: no `changes`, so the document is identical
    // and every heading is exactly where it was.
    await act(async () => { cm.dispatch({ selection: { anchor: 3 } }); });
    await act(async () => { cm.dispatch({ selection: { anchor: 12 } }); });
    await act(async () => { cm.dispatch({ selection: { anchor: 20 } }); });

    expect(buildOutlineSpy.mock.calls.length).toBe(before);
  });
});
