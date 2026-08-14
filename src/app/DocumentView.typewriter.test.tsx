// @vitest-environment jsdom
import { vi } from 'vitest';

// Recording stand-in for the real tracker. The point of this file is to prove
// DocumentView actually WIRES the re-arm, not to re-test the tracker itself
// (that is covered in writingmodes/typewriterDragGuard.test.ts).
const subscribers = new Set<() => void>();
vi.mock('../writingmodes/pointerState', () => ({
  isPointerDown: () => false,
  subscribePointerRelease: (cb: () => void) => {
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
  },
  resetPointerStateForTests: () => {},
}));

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { createRef } from 'react';
import { DocumentView, type DocumentViewHandle } from './DocumentView';
import { MODES_OFF, type WritingModes } from '../settings/writingModes';
import { DocumentSession } from '../files/documentSession';
import { formatForPath } from '../files/fileTypes';
import type { OpenDoc } from '../files/openDocuments';

/**
 * DocumentView must SUBSCRIBE the typewriter re-arm (6c-ii-b, F1 follow-up).
 *
 * The mechanism is tested next door; this asserts the connection, which is the
 * part that has failed twice in this phase family — ⌥⌘F emitted an event
 * nobody listened for, and Task 1b's devtools cfg compiled to a no-op in the
 * only build that mattered. Both were plausible code with a green suite. A
 * working tracker that DocumentView never subscribes to would look exactly the
 * same, and the only symptom would be the GUI defect this fix exists to
 * remove: a plain click never centring the caret.
 */

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

beforeAll(() => {
  // jsdom has no layout, so CodeMirror's coordsAtPos reaches
  // `textRange(...).getClientRects` and throws. Returning an empty rect list
  // makes coordsAtPos report null, which `holdCaret` already handles by
  // declining to scroll — so the mount completes and the subscription this
  // file is about still registers. The scroll itself is GUI-verified; it is
  // not what is under test here.
  const empty = { length: 0, item: () => null, *[Symbol.iterator]() {} };
  Range.prototype.getClientRects = () => empty as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => ({
    top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  container = null; root = null;
  subscribers.clear();
});

/** Built the same way DocumentView.find.test.tsx builds one. */
function makeDoc(): OpenDoc {
  const path = '/tmp/typewriter-wiring.md';
  const session = new DocumentSession({
    path, format: formatForPath(path), meta: { eol: 'lf', hadBom: false },
    text: 'alpha\n\nbravo\n',
  });
  return { id: 'tw-doc', session, viewMode: 'code' };
}

async function mountWith(modes: WritingModes) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const ref = createRef<DocumentViewHandle>();
  root = createRoot(container);
  await act(async () => root!.render(
    <DocumentView
      ref={ref} doc={makeDoc()} effectiveTheme="light" modes={modes}
      onDirtyChange={() => {}} onLiveAvailableChange={() => {}}
      onError={() => {}} onInfo={() => {}}
    />,
  ));
}

describe('DocumentView typewriter wiring', () => {
  it('subscribes to pointer release when typewriter mode is ON', async () => {
    await mountWith({ typewriter: true, focus: false });
    expect(
      subscribers.size,
      'nothing subscribed — a plain click would never hold the caret line',
    ).toBeGreaterThan(0);
  });

  it('does NOT subscribe while typewriter mode is off', async () => {
    // Mode-gated, so the mode being off costs nothing and cannot scroll.
    await mountWith(MODES_OFF);
    expect(subscribers.size).toBe(0);
  });

  it('unsubscribes when the mode is switched off', async () => {
    await mountWith({ typewriter: true, focus: false });
    expect(subscribers.size).toBeGreaterThan(0);
    await act(async () => root!.render(
      <DocumentView
        doc={makeDoc()} effectiveTheme="light" modes={MODES_OFF}
        onDirtyChange={() => {}} onLiveAvailableChange={() => {}}
        onError={() => {}} onInfo={() => {}}
      />,
    ));
    expect(subscribers.size, 'a stale subscriber would scroll with the mode off').toBe(0);
  });
});
