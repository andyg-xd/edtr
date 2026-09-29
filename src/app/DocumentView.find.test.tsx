// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, createRef, type RefObject } from 'react';
import { EditorView as CMEditorView } from '@codemirror/view';
import { DocumentView, REPLACE_ALL_CONFIRM_THRESHOLD, type DocumentViewHandle } from './DocumentView';
import { DocumentSession } from '../files/documentSession';
import { formatForPath } from '../files/fileTypes';
import type { OpenDoc, ViewMode } from '../files/openDocuments';
import { codeSurface } from '../find/codeSurface';
import { MODES_OFF } from '../settings/writingModes';

// DocumentView unconditionally wires a window-level drag/drop listener via
// getCurrentWebview() (image-drop support) on every mount — nothing to do with
// find, but real enough that jsdom (no __TAURI_INTERNALS__) throws reaching it.
// Stub it exactly the way the drop feature already treats "no webview": an
// onDragDropEvent that never resolves the app's own listener.
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => new Promise<() => void>(() => {}) }),
}));

// `codeSurface` as a spy that calls through to the real implementation by
// default — every existing test below still gets the real surface. Only the
// FIX 9 regression test overrides it, for exactly one call, to reproduce a
// surface driver meeting a node it doesn't understand.
vi.mock('../find/codeSurface', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../find/codeSurface')>();
  return { ...actual, codeSurface: vi.fn(actual.codeSurface) };
});

// `MATCH_CAP` as a mutable, hoisted binding — the "capped Replace All" test
// (Finding 4 of the final review) injects a SMALL cap through it, so a
// five-line fixture can prove the overflow message instead of needing 5001
// real matches to reach the production constant. `vi.hoisted` (not a bare
// module-level `let`) is required: `vi.mock` factories run before the rest
// of the file's top-level code, so anything they close over must be created
// through this API or the reference would be undefined at mock-time. Every
// test but that one leaves `matchCap.current` at the real value, which the
// factory below self-corrects to on first load (rather than hardcoding 5000
// here, which would silently drift out of sync if matchText.ts's own
// constant ever changed). `replaceText.ts`'s `computeReplacements` and
// `DocumentView.tsx`'s own `onReplaceAll` both import `MATCH_CAP` from this
// same resolved module, so both see the injected value; `matchSegments`'s
// (find-count) use of `MATCH_CAP` is a reference INTERNAL to the real,
// un-mocked module returned by `importOriginal`, so it is unaffected — this
// mock cannot change how many matches the find bar itself reports.
const matchCap = vi.hoisted(() => ({ real: 5000, current: 5000 }));
vi.mock('../find/matchText', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../find/matchText')>();
  matchCap.real = actual.MATCH_CAP;
  matchCap.current = matchCap.real;
  return { ...actual, get MATCH_CAP() { return matchCap.current; } };
});

// jsdom implements Element.getClientRects but not Range.getClientRects (real
// browsers have both). CodeMirror's periodic text-measurement pass calls the
// Range version and, with a doc mounted for the debounce/settle waits below,
// actually gets scheduled during the test — polyfill it as empty so that pass
// no-ops instead of throwing from inside a requestAnimationFrame callback.
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function (this: Range) { return [] as unknown as DOMRectList; };
  Range.prototype.getBoundingClientRect = function (this: Range) { return new DOMRect(); };
}

// jsdom's navigator.vendor is "Apple Computer, Inc.", which makes ProseMirror's
// UA-sniffed `safari` flag true. Real Safari uses that flag to work around a
// shadow-DOM selection bug via a `document.execCommand('indent')` hack (see
// prosemirror-view's `safariShadowSelectionRange`) -- reachable here only
// because Task 7 is the first thing to call `.focus()`/dispatch a selection
// change on a ProseMirror view mounted inside a REAL shadow root (HtmlLiveView)
// in a test. jsdom has no execCommand at all, so the hack throws instead of
// no-op'ing the way it would on a browser that just doesn't run the workaround.
// Stub it as a no-op "unsupported command" so the caller's existing fallback
// (falling back to the plain DOM selection) takes over, same as a browser
// without the bug would.
if (typeof document.execCommand !== 'function') {
  document.execCommand = () => false;
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
// Same two "hello" occurrences as MD, so the count assertions carry over
// unchanged across all three cases below.
const HTML = '<!doctype html>\n<html><body><h1>Title</h1><p>hello world, hello again</p></body></html>';

/**
 * Three cases, not two: `format` is derived from `path` (as it is for a real
 * opened file), so a Markdown fixture can only ever mount CodeView or the
 * Markdown LiveView. The load-bearing case is 'HTML Live': it is the only one
 * that mounts `HtmlLiveView`, whose `onEdit` fires on every transaction
 * (including a highlight-only one) rather than gating on `tr.docChanged` the
 * way the Markdown LiveView does — see `handleLiveEdit`'s `docChanged` check
 * in DocumentView.tsx. Without a case that actually mounts it, that guard is
 * unreachable dead code as far as this suite can see.
 */
const CASES = [
  { label: 'code view', path: '/tmp/find.md', text: MD, viewMode: 'code' as const },
  { label: 'Markdown Live', path: '/tmp/find.md', text: MD, viewMode: 'live' as const },
  { label: 'HTML Live', path: '/tmp/find.html', text: HTML, viewMode: 'live' as const },
];

/** Build a bare OpenDoc the same way useOpenDocuments.test.tsx builds a session
 * — `new DocumentSession(...)` directly — rather than inventing a new factory. */
function makeDoc(path: string, text: string, viewMode: ViewMode): OpenDoc {
  const session = new DocumentSession({
    path, format: formatForPath(path), meta: { eol: 'lf', hadBom: false }, text,
  });
  return { id: 'find-test-doc', session, viewMode };
}

async function mount(
  path: string, text: string, viewMode: ViewMode,
  onDirtyChange: (dirty: boolean) => void = () => {},
  onError: (msg: string | null) => void = () => {},
  onInfo: (msg: string) => void = () => {},
) {
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
      onDirtyChange={onDirtyChange} onLiveAvailableChange={() => {}} onError={onError} onInfo={onInfo}
    />,
  ));
  return { ref, doc, container: container! };
}

/** Re-render the SAME root with a new `doc` -- the exact shape of a real
 * Code<->Live toggle (EditorWindow flips `doc.viewMode`, not `DocumentView`'s
 * `key`; see EditorWindow.tsx's `key={`${active.id}:${activeNonce}`}`). */
async function rerender(root: ReturnType<typeof createRoot>, ref: RefObject<DocumentViewHandle | null>, doc: OpenDoc) {
  await act(async () => root.render(
    <DocumentView
      ref={ref} doc={doc} effectiveTheme="light" modes={MODES_OFF}
      onSetWritingMode={() => {}} onExport={() => {}}
      onDirtyChange={() => {}} onLiveAvailableChange={() => {}} onError={() => {}} onInfo={() => {}}
    />,
  ));
}

const bar = (c: HTMLElement) => c.querySelector('.find-bar');
const field = (c: HTMLElement) => c.querySelector<HTMLInputElement>('.find-input')!;

/**
 * Find-decoration elements, wherever they render. Code view and Markdown Live
 * both mount directly into the light DOM; HTML Live renders ProseMirror inside
 * a shadow root (see `HtmlLiveView.test.tsx`), so its highlights live there
 * instead — the find bar itself stays in the light DOM for all three cases.
 *
 * Substring match, not an exact class token: `codeSurface`'s current-match
 * decoration carries ONLY `cm-edtr-find-current` (never also `cm-edtr-find`),
 * so an exact `.cm-edtr-find` selector counts ordinary Code-view matches but
 * silently misses the current one — a regression that cleared ordinary
 * highlights while leaving the current one behind would pass unnoticed.
 */
function highlightEls(c: HTMLElement): Element[] {
  const light = Array.from(c.querySelectorAll('[class*="cm-edtr-find"], [class*="edtr-find"]'));
  const shadow = c.querySelector('.html-live-view')?.shadowRoot;
  const inShadow = shadow ? Array.from(shadow.querySelectorAll('[class*="edtr-find"]')) : [];
  return [...light, ...inShadow];
}

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

describe.each(CASES)('DocumentView find — $label', ({ path, text, viewMode }) => {
  it('is closed until ⌘F, then opens above the editor', async () => {
    const { ref, container: c } = await mount(path, text, viewMode);
    expect(bar(c)).toBeNull();
    await act(async () => { ref.current!.openFind(); });
    expect(bar(c)).toBeTruthy();
    // The bar precedes the editor in DOM order — that is what shifts the
    // canvas down rather than covering text.
    const editor = c.querySelector('.code-view, .live-view, .html-live-view')!;
    expect(bar(c)!.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('counts matches and navigates them', async () => {
    const { ref, container: c } = await mount(path, text, viewMode);
    await act(async () => { ref.current!.openFind(); });
    await type(c, 'hello');
    expect(c.querySelector('.find-count')?.textContent).toBe('1/2');
    await act(async () => { ref.current!.findNext(); });
    expect(c.querySelector('.find-count')?.textContent).toBe('2/2');
    await act(async () => { ref.current!.findNext(); });
    expect(c.querySelector('.find-count')?.textContent).toBe('1/2'); // wraps
  });

  it('says No results in plain language', async () => {
    const { ref, container: c } = await mount(path, text, viewMode);
    await act(async () => { ref.current!.openFind(); });
    await type(c, 'zebra');
    expect(c.querySelector('.find-count')?.textContent).toBe('No results');
  });

  it('NEVER dirties the document — searching, navigating, closing, all of it', async () => {
    // THE load-bearing test (design §6). If this ever fails, stop: find has
    // started writing to files. `onDirtyChange` is threaded into `mount` (not
    // the default no-op) so the assertion below is on a spy the component can
    // actually call — a spy wired to nothing would never fail no matter what
    // find did.
    const onDirtyChange = vi.fn();
    const { ref, doc, container: c } = await mount(path, text, viewMode, onDirtyChange);
    await act(async () => { ref.current!.openFind(); });
    await type(c, 'hello');
    await act(async () => { ref.current!.findNext(); });
    await act(async () => { ref.current!.findPrev(); });
    await act(async () => { field(c).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(doc.session.text).toBe(text);
    expect(doc.session.isDirty()).toBe(false);
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  });

  it('closes on Escape and clears its highlights', async () => {
    const { ref, container: c } = await mount(path, text, viewMode);
    await act(async () => { ref.current!.openFind(); });
    await type(c, 'hello');
    // Assert highlights actually EXISTED first -- otherwise the clearing
    // assertion below rests on 0 === 0 and defends nothing.
    expect(highlightEls(c).length).toBeGreaterThan(0);
    await act(async () => { field(c).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(bar(c)).toBeNull();
    expect(highlightEls(c).length).toBe(0);
  });

  it('does not re-scan in a loop when highlighting', async () => {
    // Highlighting dispatches a transaction. If that fed the recompute, this
    // would never settle. A settling render count is the proof. This is the
    // case that matters most for 'HTML Live' — see the CASES comment above.
    const { ref, container: c } = await mount(path, text, viewMode);
    await act(async () => { ref.current!.openFind(); });
    await type(c, 'hello');
    const first = c.querySelector('.find-count')?.textContent;
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(c.querySelector('.find-count')?.textContent).toBe(first);
  });
});

/**
 * Regression: every case above mounts ONE view mode and never toggles, which
 * is exactly why a Code<->Live crash got through review. A real toggle
 * (EditorWindow flips `doc.viewMode`, keeping DocumentView's `key`) swaps
 * `surface` to the new projection in the SAME commit that the highlight/reveal
 * effects run in, while the debounced recompute is still 120ms behind holding
 * the OLD projection's positions. HTML is the fixture that actually throws:
 * its Live doc hides `<head>`/tags, so source offsets exceed the Live doc's
 * content size. `findFor` (tagging matches with the surface that produced
 * them) is what makes both effects refuse to touch a stale run.
 */
describe('DocumentView find — Code<->Live toggle (HTML, does not crash)', () => {
  it('toggling code -> live with an open, populated find bar does not throw', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const ref = createRef<DocumentViewHandle>();
    const path = '/tmp/find.html';
    const session = new DocumentSession({ path, format: formatForPath(path), meta: { eol: 'lf', hadBom: false }, text: HTML });
    const doc: OpenDoc = { id: 'toggle-doc', session, viewMode: 'code' };
    const root = createRoot(container);
    currentRoot = root;
    await rerender(root, ref, doc);
    await act(async () => { ref.current!.openFind(); });
    await type(container, 'hello');
    // The toggle itself: a bare `await` is the "does not throw" assertion —
    // if the passive effect throws (the RangeError this test reproduces), the
    // rejection propagates here and the test fails with it.
    await rerender(root, ref, { ...doc, viewMode: 'live' });
    // Let the debounced recompute catch up to the new (Live) projection.
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(container.querySelector('.find-count')?.textContent).toBe('1/2');
    // Not just the count string: the fixture yields 2 matches in BOTH
    // projections, so '1/2' reads the same whether find recovered or got
    // permanently stuck on the pre-toggle surface (proven by probe: stamping
    // `findFor` with `(prev) => prev ?? surface` -- never recovering, never
    // re-highlighting -- left all toggle assertions passing on count alone).
    // Only the highlight effect requires the stamps to match, so a stuck
    // guard yields exactly 0 decorations here.
    expect(highlightEls(container).length).toBeGreaterThan(0);
  });

  it('toggling live -> code with an open, populated find bar does not throw', async () => {
    // The mirror direction: flagged by review as the same class of bug but
    // unprobed (CodeMirror rejects out-of-range selections too), so covered
    // here rather than assumed safe from the other direction alone.
    container = document.createElement('div');
    document.body.appendChild(container);
    const ref = createRef<DocumentViewHandle>();
    const path = '/tmp/find.html';
    const session = new DocumentSession({ path, format: formatForPath(path), meta: { eol: 'lf', hadBom: false }, text: HTML });
    const doc: OpenDoc = { id: 'toggle-doc-2', session, viewMode: 'live' };
    const root = createRoot(container);
    currentRoot = root;
    await rerender(root, ref, doc);
    await act(async () => { ref.current!.openFind(); });
    await type(container, 'hello');
    await rerender(root, ref, { ...doc, viewMode: 'code' });
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(container.querySelector('.find-count')?.textContent).toBe('1/2');
    // Same rationale as the code -> live case above: count alone can't tell a
    // recovered guard from a permanently stuck one when both projections
    // yield the same match count.
    expect(highlightEls(container).length).toBeGreaterThan(0);
  });
});

/**
 * Regression for a second, independent reachable crash: a stale match within
 * the SAME surface (no toggle at all). `findFor === surface` alone survives
 * an in-place edit -- `surface` doesn't change identity just because the
 * document did -- so `findEpoch`/`findForEpoch` is what actually protects
 * this path. ⌘G/⇧⌘G are always live through the native menu, independent of
 * whatever the find bar itself is doing, so a user really can press one
 * inside the ~120ms debounce window after an edit.
 */
describe('DocumentView find — stale match after an in-place edit (does not crash)', () => {
  it('findNext before the debounce settles, right after an edit that removes the matched text, does not throw (Code view)', async () => {
    const PREFIX = 'a'.repeat(10);
    // Two matches, both inside the region the edit below deletes -- so
    // whichever one `findNext()` lands on next is equally stale.
    const BODY = 'hello world, hello again';
    const NEAR_END = PREFIX + BODY;
    const { ref, container: c } = await mount('/tmp/stale-edit.md', NEAR_END, 'code');
    await act(async () => { ref.current!.openFind(); });
    await type(c, 'hello'); // settles: 2 matches inside BODY, current = 0

    // Drive a REAL edit through the mounted CodeMirror view -- not a
    // re-render (CodeView is uncontrolled after mount: the parent remounts
    // via `key` on file change, so a text-prop-only re-render would not touch
    // its live content). Delete BODY entirely, shrinking the document down to
    // just PREFIX -- both matches' positions are now past the new doc end.
    const cmView = CMEditorView.findFromDOM(c.querySelector('.cm-editor')!)!;
    await act(async () => {
      cmView.dispatch({ changes: { from: PREFIX.length, to: NEAR_END.length, insert: '' } });
    });

    // BEFORE the 120ms debounce settles: ⌘G. `find.matches`/`find.current`
    // are still the PRE-edit run; `findFor` still equals `surface` (an
    // in-place edit never changes surface identity), so `findForEpoch` vs the
    // now-bumped `findEpoch` is the only thing that can catch this. A bare
    // `await` is the "does not throw" assertion -- a rejection here fails the
    // test with the underlying error.
    await act(async () => { ref.current!.findNext(); });
  });
});

/**
 * Regression: incremental typing must not anchor the current match on the
 * caret it just moved. Every case in the describe.each block above types its
 * whole query in ONE `input` event, so the suite structurally cannot see this
 * -- it only shows up across separate keystrokes with the 120ms debounce
 * settling between them, which is what `type()` below deliberately does.
 */
describe('DocumentView find — incremental search does not oscillate on its own reveal', () => {
  it('keeps the current match stable across separate keystrokes instead of hunting forward and wrapping', async () => {
    // Two matches straddling where a growing query's END keeps landing after
    // each reveal -- "h" at 0, "h" (of the second "hello") at 13 -- is exactly
    // what turned a LIVE cursor read into a moving target: after "h" matches
    // and reveals to [0,1], a live read for "he" sees caret 1, which is past
    // match 0 but still before match 1, so it jumps to match 1; the next
    // keystroke's reveal then puts the caret past BOTH matches, wrapping back
    // to match 0; and so on. A caret captured once, at the h->non-empty
    // transition, stays 0 the whole time, so the first match should win at
    // every step.
    const TEXT = 'hello world, hello again';
    const { ref, container: c } = await mount('/tmp/anchor.md', TEXT, 'code');
    await act(async () => { ref.current!.openFind(); });
    for (const partial of ['h', 'he', 'hel', 'hell', 'hello']) {
      await type(c, partial);
      expect(c.querySelector('.find-count')?.textContent).toBe('1/2');
    }
  });
});

describe.each(CASES)('DocumentView find — navigation survives the recompute — $label', ({ path, text, viewMode }) => {
  it('stays on the next match after the debounce and a parent re-render', async () => {
    // EditorWindow passes `onError` as an inline arrow, and re-renders on
    // every caret move while the outline reports its active heading -- which
    // `reveal()` causes. A recompute keyed on that callback re-anchored the
    // current match ~120ms after every step, so next/prev visibly jumped and
    // snapped back. `rerender` passes fresh callbacks, the same shape.
    container = document.createElement('div');
    document.body.appendChild(container);
    const ref = createRef<DocumentViewHandle>();
    const doc = makeDoc(path, text, viewMode);
    const root = createRoot(container);
    currentRoot = root;
    await rerender(root, ref, doc);
    await act(async () => { ref.current!.openFind(); });
    await type(container, 'hello');
    await act(async () => { ref.current!.findNext(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(container.querySelector('.find-count')?.textContent).toBe('2/2');
    await rerender(root, ref, doc);
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(container.querySelector('.find-count')?.textContent).toBe('2/2');
  });
});

/**
 * Regression for design §7.3: a surface driver meeting a node it doesn't
 * understand must degrade to "no matches" and surface through the banner,
 * not throw unhandled out of the debounced recompute's `setTimeout` — which
 * has no passive-effect boundary to land in and would leave find silently,
 * permanently dead (5f's lesson about silent feature-disabling errors).
 */
describe('DocumentView find — a surface driver error degrades to no matches, not a crash', () => {
  it('reports the error through onError and leaves the bar showing no results, not broken', async () => {
    // `mockImplementationOnce` overrides exactly the NEXT call and then falls
    // back to the factory's default (a passthrough to the real `codeSurface`,
    // set up once at the top of this file) — no explicit restore needed, and
    // every other test in this file keeps getting the real surface.
    vi.mocked(codeSurface).mockImplementationOnce(() => ({
      multiline: true,
      getSegments: () => { throw new Error('unexpected node'); },
      cursorPos: () => 0,
      selectedText: () => '',
      highlight: () => {},
      reveal: () => {},
      editable: () => true,
      applyEdits: () => ({ crossedFormatting: false, removedImages: 0, removedEmbedded: 0 }),
      inspectEdits: () => ({ atomSpans: 0 }),
    }));
    const onError = vi.fn();
    const { ref, container: c } = await mount('/tmp/find-error.md', 'hello world', 'code', undefined, onError);
    // A bare `await` on openFind is itself part of the "does not throw"
    // assertion — the debounced recompute runs on a real timer, outside any
    // `act()` this call could propagate a rejection through, so an uncaught
    // throw here would surface as an unhandled rejection failing the test.
    await act(async () => { ref.current!.openFind(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(onError).toHaveBeenCalled();
    const message = onError.mock.calls[0]?.[0] as string;
    expect(message).toContain("couldn't search");
    // Degraded, not crashed: the bar is still there, showing no results.
    expect(bar(c)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Replace (6c-i-b). Code view is the surface under test for the behavioural
// cases: it is the one whose result can be asserted directly against the
// source string, so a wrong edit shows up as wrong BYTES rather than as a
// ProseMirror shape that still has to be interpreted.
// ---------------------------------------------------------------------------

const replaceField = (c: HTMLElement) => c.querySelector<HTMLInputElement>('.find-replace-input')!;
const guard = (c: HTMLElement) => c.querySelector('[aria-label="Replace all"]');

/** Type into the REPLACE field. Same native-setter bypass as `type` above:
 *  React's value tracker swallows a direct assignment. No debounce wait —
 *  the replacement term feeds no matcher, so nothing is scheduled off it. */
async function typeReplace(c: HTMLElement, text: string) {
  const el = replaceField(c);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const click = async (el: Element | null) => {
  await act(async () => (el as HTMLButtonElement).click());
  // Replace bumps the find epoch, so let the debounced recompute settle.
  await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
};

const clickReplace = (c: HTMLElement) => click(c.querySelector('.find-replace'));
const clickReplaceAll = (c: HTMLElement) => click(c.querySelector('.find-replace-all'));

describe('DocumentView replace', () => {
  it('replaces the current match and leaves the rest of the document alone', async () => {
    const { ref, doc, container: c } = await mount('/tmp/r.md', 'cat and cat', 'code');
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'dog');
    await clickReplace(c);
    expect(doc.session.text).toBe('dog and cat');
  });

  it('advances past a replacement that itself contains the query', async () => {
    // The hazard: the replacement re-matches, so a Replace that re-anchored at
    // the match START would find its own output and rewrite the same spot
    // forever instead of moving on. Anchoring PAST the inserted text is what
    // advances to the next real occurrence.
    //
    // Two matches are required to see it: with a single occurrence the correct
    // anchor lands past the end, the search wraps to index 0, and a broken
    // anchor lands there too — the bug hides behind the wrap. (Verified: an
    // earlier single-occurrence version of this test passed with the anchor
    // deliberately broken, which is why it looks like this.)
    const { ref, doc, container: c } = await mount('/tmp/r.md', 'cat cat', 'code');
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'cat!');
    await clickReplace(c);
    await clickReplace(c);
    // Both occurrences replaced once each. Re-anchoring at the match start
    // would instead rewrite the first one twice: 'cat!! cat'.
    expect(doc.session.text).toBe('cat! cat!');
  });

  it('replaces all with no confirmation at or below the threshold', async () => {
    const { ref, doc, container: c } = await mount('/tmp/r.md', 'cat cat cat', 'code');
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'dog');
    await clickReplaceAll(c);
    expect(guard(c)).toBeNull();
    expect(doc.session.text).toBe('dog dog dog');
  });

  it('does NOT confirm at exactly the threshold', async () => {
    // The boundary is `> THRESHOLD`, not `>=`. Exactly-at-the-threshold is the
    // classic off-by-one site, and the other tests only cover 2, 3 and N+1.
    const source = 'cat '.repeat(REPLACE_ALL_CONFIRM_THRESHOLD).trim();
    const { ref, doc, container: c } = await mount('/tmp/r.md', source, 'code');
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'dog');
    await clickReplaceAll(c);
    expect(guard(c)).toBeNull();
    expect(doc.session.text).toBe('dog '.repeat(REPLACE_ALL_CONFIRM_THRESHOLD).trim());
  });

  it('confirms above the threshold, and cancelling changes absolutely nothing', async () => {
    const source = 'cat '.repeat(REPLACE_ALL_CONFIRM_THRESHOLD + 1).trim();
    const onInfo = vi.fn();
    const { ref, doc, container: c } = await mount('/tmp/r.md', source, 'code', () => {}, () => {}, onInfo);
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'dog');
    await clickReplaceAll(c);
    // Nothing applied yet — the dialog is the gate, not a notification.
    expect(guard(c)).not.toBeNull();
    expect(guard(c)!.textContent).toContain(`Replace all ${REPLACE_ALL_CONFIRM_THRESHOLD + 1} matches?`);
    expect(doc.session.text).toBe(source);
    // Scope to the dialog: the find bar's own prev/next/toggle/close buttons
    // are all `.btn--secondary` too, and they come first in the DOM.
    await click(guard(c)!.querySelector('.btn--secondary'));
    // Cancel: no edits, no notice, and the dialog is gone.
    expect(doc.session.text).toBe(source);
    expect(onInfo).not.toHaveBeenCalled();
    expect(guard(c)).toBeNull();
  });

  it('applies the confirmed batch and reports the count', async () => {
    const source = 'cat '.repeat(REPLACE_ALL_CONFIRM_THRESHOLD + 1).trim();
    const onInfo = vi.fn();
    const { ref, doc, container: c } = await mount('/tmp/r.md', source, 'code', () => {}, () => {}, onInfo);
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'dog');
    await clickReplaceAll(c);
    await click(guard(c)!.querySelector('.btn--primary'));
    expect(doc.session.text).toBe('dog '.repeat(REPLACE_ALL_CONFIRM_THRESHOLD + 1).trim());
    // D5 reports the count "either way"; this is the confirmed path.
    expect(onInfo).toHaveBeenCalledWith(`Replaced ${REPLACE_ALL_CONFIRM_THRESHOLD + 1} matches.`);
  });

  it('reports the count for a below-threshold replace all too', async () => {
    // D5 says "either way". A small batch is still a bulk action, and the
    // count is how the user learns the scope without counting highlights.
    const onInfo = vi.fn();
    const { ref, container: c } = await mount('/tmp/r.md', 'cat cat', 'code', () => {}, () => {}, onInfo);
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'dog');
    await clickReplaceAll(c);
    expect(onInfo).toHaveBeenCalledWith('Replaced 2 matches.');
  });

  it('⌘F opens find-only; ⌥⌘F opens with the replace row', async () => {
    const { ref, container: c } = await mount('/tmp/r.md', 'cat', 'code');
    await act(async () => { ref.current!.openFind(); });
    expect(c.querySelector('.find-replace-row')).toBeNull();
    await act(async () => { ref.current!.openReplace(); });
    expect(c.querySelector('.find-replace-row')).not.toBeNull();
    // ...and back: ⌘F must always land on find-only, whatever was showing.
    await act(async () => { ref.current!.openFind(); });
    expect(c.querySelector('.find-replace-row')).toBeNull();
  });

  it('keeps the replacement term across a find-only reopen', async () => {
    const { ref, container: c } = await mount('/tmp/r.md', 'cat', 'code');
    await act(async () => { ref.current!.openReplace(); });
    await typeReplace(c, 'dog');
    await act(async () => { ref.current!.openFind(); });
    await act(async () => { ref.current!.openReplace(); });
    expect(replaceField(c).value).toBe('dog');
  });
});

describe('DocumentView replace — disclosure (D2 + D6)', () => {
  /** The real code surface, but reporting an outcome we choose. Code view has
   *  neither formatting nor atoms in reality, so a stub is the only way to
   *  exercise the disclosure wiring from this layer — and the wiring is what
   *  is under test, not the surface's own counting (pmSurface.test.ts owns
   *  that). Applies nothing: the notice, not the bytes, is the subject. */
  function stubOutcome(outcome: { crossedFormatting: boolean; removedImages: number; removedEmbedded: number }) {
    const real = vi.mocked(codeSurface).getMockImplementation()!;
    vi.mocked(codeSurface).mockImplementation((view) => ({
      ...real(view),
      editable: () => true,
      applyEdits: () => outcome,
      inspectEdits: () => ({ atomSpans: outcome.removedImages + outcome.removedEmbedded }),
    }));
  }
  afterEach(() => { vi.mocked(codeSurface).mockReset(); });

  it('discloses a formatting crossing once per action, not per occurrence', async () => {
    stubOutcome({ crossedFormatting: true, removedImages: 0, removedEmbedded: 0 });
    const onInfo = vi.fn();
    const { ref, container: c } = await mount('/tmp/r.md', 'cat cat cat', 'code', () => {}, () => {}, onInfo);
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'dog');
    await clickReplaceAll(c);
    // THREE occurrences crossed; ONE notice.
    expect(onInfo).toHaveBeenCalledTimes(1);
    expect(onInfo.mock.calls[0][0]).toContain('Replaced across formatting.');
  });

  it('discloses removed pictures alongside the count, in ONE message', async () => {
    // The defect this pins: onInfo drives a single-slot banner, so a count
    // reported as a SECOND call silently overwrote D6's disclosure and the
    // user saw only "Replaced N matches." The disclosure must survive.
    stubOutcome({ crossedFormatting: false, removedImages: 2, removedEmbedded: 0 });
    const onInfo = vi.fn();
    const { ref, container: c } = await mount('/tmp/r.md', 'cat cat', 'code', () => {}, () => {}, onInfo);
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'dog');
    await clickReplaceAll(c);
    expect(onInfo).toHaveBeenCalledTimes(1);
    const msg = onInfo.mock.calls[0][0] as string;
    expect(msg).toContain('Replaced 2 matches.');
    expect(msg).toContain('2 pictures');
    expect(msg).toContain('picture files are still saved next to your document');
  });

  it('discloses a single removed picture after a single Replace, with no count', async () => {
    stubOutcome({ crossedFormatting: false, removedImages: 1, removedEmbedded: 0 });
    const onInfo = vi.fn();
    const { ref, container: c } = await mount('/tmp/r.md', 'cat cat', 'code', () => {}, () => {}, onInfo);
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'dog');
    await clickReplace(c);
    expect(onInfo).toHaveBeenCalledTimes(1);
    const msg = onInfo.mock.calls[0][0] as string;
    expect(msg).toContain('Replaced across a picture.');
    expect(msg).toContain('the picture file is still saved next to your document');
    // A single Replace is one match by definition — a count would be noise.
    expect(msg).not.toContain('matches.');
  });

  /**
   * Finding 2 of the final review: the old wording claimed survival for
   * BOTH SKIP_ATOMS kinds alike ("picture or embedded item ... picture files
   * are still saved"), which is false for anything that isn't an image — an
   * <abbr>, an inline <svg>, a <script>-shaped block, etc. all flatten to the
   * SAME "embedded item" wording the old code used, and none of them have a
   * file anywhere once the edit lands. These three cases pin that the
   * message never makes that claim for embedded content, alone or alongside
   * a real picture.
   */
  it('discloses removed embedded content truthfully — no survival claim', async () => {
    stubOutcome({ crossedFormatting: false, removedImages: 0, removedEmbedded: 1 });
    const onInfo = vi.fn();
    const { ref, container: c } = await mount('/tmp/r.md', 'cat cat', 'code', () => {}, () => {}, onInfo);
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'dog');
    await clickReplace(c);
    expect(onInfo).toHaveBeenCalledTimes(1);
    const msg = onInfo.mock.calls[0][0] as string;
    expect(msg).toContain('Replaced across some embedded content.');
    expect(msg).toContain('removed from the file');
    // The whole point: unlike a picture, nothing here is claimed to survive.
    expect(msg).not.toContain('saved next to your document');
    expect(msg).not.toContain('matches.');
  });

  it('discloses several removed pieces of embedded content, pluralised, still with no survival claim', async () => {
    stubOutcome({ crossedFormatting: false, removedImages: 0, removedEmbedded: 3 });
    const onInfo = vi.fn();
    const { ref, container: c } = await mount('/tmp/r.md', 'cat cat cat', 'code', () => {}, () => {}, onInfo);
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'dog');
    await clickReplaceAll(c);
    const msg = onInfo.mock.calls[0][0] as string;
    expect(msg).toContain('Replaced 3 matches.');
    expect(msg).toContain('3 pieces of embedded content');
    expect(msg).toContain('removed from the file');
    expect(msg).not.toContain('saved next to your document');
  });

  it('discloses BOTH a removed picture and removed embedded content in one message, each with the right claim', async () => {
    stubOutcome({ crossedFormatting: false, removedImages: 1, removedEmbedded: 1 });
    const onInfo = vi.fn();
    const { ref, container: c } = await mount('/tmp/r.md', 'cat cat', 'code', () => {}, () => {}, onInfo);
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'dog');
    await clickReplaceAll(c);
    expect(onInfo).toHaveBeenCalledTimes(1); // still ONE message
    const msg = onInfo.mock.calls[0][0] as string;
    expect(msg).toContain('Replaced 2 matches.');
    // The picture: survives.
    expect(msg).toContain('a picture');
    expect(msg).toContain('still saved next to your document');
    // The embedded content: does not.
    expect(msg).toContain('embedded content');
    expect(msg).toContain('removed from the file');
  });

  it('says nothing when there is nothing to disclose', async () => {
    stubOutcome({ crossedFormatting: false, removedImages: 0, removedEmbedded: 0 });
    const onInfo = vi.fn();
    const { ref, container: c } = await mount('/tmp/r.md', 'cat cat', 'code', () => {}, () => {}, onInfo);
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'dog');
    await clickReplace(c);
    expect(onInfo).not.toHaveBeenCalled();
  });
});

describe('DocumentView replace — stale-match guard', () => {
  it('ignores a second Replace fired inside the debounce window', async () => {
    // Enter in the replace field fires onReplace, and macOS key repeat is
    // faster than FIND_DEBOUNCE_MS. Without the freshness gate, the second
    // press replays the PRE-EDIT match position against the already-edited
    // document -- and when the replacement re-matches, that rewrites the
    // occurrence just replaced ('cat!! cat') instead of doing nothing.
    //
    // Deliberately NO debounce wait between the presses: every other test here
    // sleeps 200ms, which is exactly why this window was never exercised.
    const { ref, doc, container: c } = await mount('/tmp/r.md', 'cat cat', 'code');
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'cat!');
    const btn = c.querySelector('.find-replace') as HTMLButtonElement;
    // Two SEPARATE act() flushes, not two clicks inside one. Key repeat
    // delivers discrete events that each let React commit, so the second press
    // sees the epoch the first one bumped -- batching both into a single
    // commit would model an input the OS never produces, and the guard (which
    // reads render-scoped state) could not see it in that shape either.
    await act(async () => { btn.click(); });
    await act(async () => { btn.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    // Exactly one replacement landed; the stale second press did nothing.
    expect(doc.session.text).toBe('cat! cat');
  });
});

/**
 * Finding 1 of the final review: the modal backdrop (`.modal-backdrop` in
 * banners.css) is a plain `position: fixed` div with no `inert` and no focus
 * trap, `ReplaceAllGuard` sets no initial focus, neither editor sets
 * `tabIndex={-1}`, and the native Edit menu's Find/Replace stay live. So the
 * user really can reach the editor (Tab, or the menu) and edit the document
 * WHILE the "Replace all N matches?" dialog is still up, then confirm — and
 * the frozen edit set's positions describe a document version that no
 * longer exists. Applying it anyway would silently rewrite whatever text
 * now happens to sit at those stale positions while the banner still claims
 * the original count.
 */
describe('DocumentView replace — a stale pending Replace All is discarded, not applied (Finding 1)', () => {
  it('drops the frozen batch and changes nothing when the document was edited while the dialog was open', async () => {
    const source = 'cat '.repeat(REPLACE_ALL_CONFIRM_THRESHOLD + 1).trim();
    const onInfo = vi.fn();
    const { ref, doc, container: c } = await mount('/tmp/r.md', source, 'code', () => {}, () => {}, onInfo);
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'dog');
    await clickReplaceAll(c);
    expect(guard(c)).not.toBeNull(); // above the threshold -- nothing applied yet

    // Model the missing focus trap with a REAL edit through the mounted
    // CodeMirror view, same technique as the "stale match after an in-place
    // edit" regression test above -- this is what a user Tabbing into the
    // editor (or reaching it via the still-live Edit menu) while the dialog
    // is open would actually produce. Replace the WHOLE document, so every
    // one of the frozen edits' positions is now either meaningless or points
    // at completely different text.
    const cmView = CMEditorView.findFromDOM(c.querySelector('.cm-editor')!)!;
    await act(async () => {
      cmView.dispatch({ changes: { from: 0, to: source.length, insert: 'something else entirely' } });
    });

    // Confirm. If the stale set were applied, it would rewrite whatever text
    // now sits at the frozen positions (silently corrupting the just-typed
    // replacement) or throw trying to. Neither may happen.
    await click(guard(c)!.querySelector('.btn--primary'));
    expect(doc.session.text).toBe('something else entirely'); // untouched by the stale batch
    expect(guard(c)).toBeNull(); // the dialog still closes
    // Told, not left to wonder why nothing happened -- and NOT the ordinary
    // "Replaced N matches." success message, which would be a lie here.
    expect(onInfo).toHaveBeenCalledTimes(1);
    const msg = onInfo.mock.calls[0][0] as string;
    expect(msg).not.toContain('Replaced');
    expect(msg.toLowerCase()).toContain('nothing was replaced');
  });

  it('still applies normally when the document was NOT touched while the dialog was open', async () => {
    // The counterpart proof: the freshness check must not become a second
    // reason Replace All silently does nothing on the ordinary, untouched
    // path — REPLACE_ALL_CONFIRM_THRESHOLD's own "applies the confirmed
    // batch and reports the count" test already covers this, but repeating
    // it here documents that Finding 1's guard is what makes it still true.
    const source = 'cat '.repeat(REPLACE_ALL_CONFIRM_THRESHOLD + 1).trim();
    const onInfo = vi.fn();
    const { ref, doc, container: c } = await mount('/tmp/r.md', source, 'code', () => {}, () => {}, onInfo);
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'dog');
    await clickReplaceAll(c);
    await click(guard(c)!.querySelector('.btn--primary'));
    expect(doc.session.text).toBe('dog '.repeat(REPLACE_ALL_CONFIRM_THRESHOLD + 1).trim());
    expect(onInfo).toHaveBeenCalledWith(`Replaced ${REPLACE_ALL_CONFIRM_THRESHOLD + 1} matches.`);
  });
});

/**
 * Finding 4 of the final review: `computeReplacements` truncates silently AT
 * whatever cap it is given, so a plain call can never tell "there were
 * exactly the cap's worth of matches" apart from "there were far more and
 * the rest got silently dropped" — the old code reported both the same way,
 * "Replaced N matches.", which reads as the whole job being done.
 *
 * `matchCap.current` (set up top-of-file via `vi.mock('../find/matchText')`)
 * injects a SMALL cap so this is provable with a five-line fixture instead
 * of needing 5001 real matches to reach the production MATCH_CAP.
 */
describe('DocumentView replace — a capped Replace All is disclosed truthfully, not as complete (Finding 4)', () => {
  afterEach(() => { matchCap.current = matchCap.real; }); // never leak the injected cap into later tests

  it('reports only the replaced count and says more remain, when the true match count exceeds the cap', async () => {
    matchCap.current = 3;
    const source = 'cat '.repeat(5).trim(); // 5 real matches > the injected cap of 3
    const onInfo = vi.fn();
    const { ref, doc, container: c } = await mount('/tmp/r.md', source, 'code', () => {}, () => {}, onInfo);
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'dog');
    await clickReplaceAll(c);
    // 3 edits is BELOW REPLACE_ALL_CONFIRM_THRESHOLD (10) — this run goes
    // straight through with no guard dialog. The cap and the confirmation
    // threshold are independent knobs; this test isolates the cap alone.
    expect(guard(c)).toBeNull();
    // Only the first 3 of the 5 real matches were touched.
    expect(doc.session.text).toBe('dog dog dog cat cat');
    expect(onInfo).toHaveBeenCalledTimes(1);
    const msg = onInfo.mock.calls[0][0] as string;
    expect(msg).toContain('Replaced the first 3 matches.');
    expect(msg).not.toContain('Replaced 3 matches.'); // must not read as complete
    expect(msg.toLowerCase()).toContain('run replace all again');
  });

  it('reports a normal, uncapped count when the true match count is at or under the cap', async () => {
    matchCap.current = 3;
    const onInfo = vi.fn();
    const { ref, doc, container: c } = await mount('/tmp/r.md', 'cat cat cat', 'code', () => {}, () => {}, onInfo);
    await act(async () => { ref.current!.openReplace(); });
    await type(c, 'cat');
    await typeReplace(c, 'dog');
    await clickReplaceAll(c);
    expect(doc.session.text).toBe('dog dog dog');
    expect(onInfo).toHaveBeenCalledWith('Replaced 3 matches.'); // exactly at the cap, NOT reported as capped
  });
});
