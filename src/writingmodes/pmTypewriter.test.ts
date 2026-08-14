// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { liveSchema } from '../views/liveSchema';
import { toLiveHtml } from '../views/htmlModel';
import { pmTypewriter, scrollerFor } from './pmTypewriter';
import { END_PAD_RATIO, HOLD_RATIO } from './constants';

function mountIn(host: HTMLElement, text: string): EditorView {
  const doc = liveSchema.node('doc', null, [
    liveSchema.node('paragraph', { blockId: 'b0' }, [liveSchema.text(text)]),
  ]);
  return new EditorView(host, { state: EditorState.create({ doc }) });
}

describe('scrollerFor', () => {
  it('finds the Markdown Live scroller in the light DOM', () => {
    const scroller = document.createElement('div');
    scroller.className = 'live-view';
    document.body.appendChild(scroller);
    const view = mountIn(scroller, 'hello');
    expect(scrollerFor(view)).toBe(scroller);
    view.destroy(); scroller.remove();
  });

  it('steps out of a shadow root to find the HTML Live scroller', () => {
    // The real HTML Live case: the editor lives inside a shadow root whose
    // host carries the scrolling class. `closest()` alone cannot cross that
    // boundary, which is the whole reason this helper exists.
    const host = document.createElement('div');
    host.className = 'html-live-view';
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const mountPoint = document.createElement('div');
    root.appendChild(mountPoint);
    const view = mountIn(mountPoint, 'hello');
    expect(scrollerFor(view)).toBe(host);
    view.destroy(); host.remove();
  });

  it('returns null when no known scroller is present', () => {
    const orphan = document.createElement('div');
    document.body.appendChild(orphan);
    const view = mountIn(orphan, 'hello');
    expect(scrollerFor(view)).toBeNull();
    view.destroy(); orphan.remove();
  });
});

describe('pmTypewriter', () => {
  it('asks to scroll the caret line centre to the hold ratio', () => {
    const scroller = document.createElement('div');
    scroller.className = 'live-view';
    document.body.appendChild(scroller);
    const view = mountIn(scroller, 'hello');
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 60, bottom: 80, left: 0, right: 0 });
    const calls: { targetCentreY: number; ratio: number }[] = [];
    pmTypewriter(view, (o) => calls.push(o)).holdCaret(HOLD_RATIO);
    expect(calls).toEqual([{ scroller, targetCentreY: 70, ratio: HOLD_RATIO }]);
    view.destroy(); scroller.remove();
  });

  // Unlike CodeMirror's `coordsAtPos` (which types as `Rect | null` and is
  // exercised for that in codeTypewriter.test.ts), ProseMirror's never
  // returns null — an out-of-range position THROWS instead. The bounds check
  // above the call is this surface's equivalent defense in depth, matching
  // `pmSurface.ts`'s `reveal()`; it isn't independently mockable the way
  // CodeMirror's null return is, so it's covered by construction rather than
  // a dedicated unit test.
  it('never dispatches a transaction', () => {
    const scroller = document.createElement('div');
    scroller.className = 'live-view';
    document.body.appendChild(scroller);
    const view = mountIn(scroller, 'hello');
    const dispatch = vi.spyOn(view, 'dispatch');
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 0, bottom: 10, left: 0, right: 0 });
    const s = pmTypewriter(view, () => {});
    s.holdCaret(HOLD_RATIO);
    s.setEndPadding(true);
    expect(dispatch).not.toHaveBeenCalled();
    view.destroy(); scroller.remove();
  });

  it('adds end padding as a pixel value and removes it again', () => {
    const scroller = document.createElement('div');
    scroller.className = 'live-view';
    document.body.appendChild(scroller);
    Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true });
    const view = mountIn(scroller, 'hello');
    const surface = pmTypewriter(view);
    surface.setEndPadding(true);
    expect(scroller.classList.contains('edtr-typewriter')).toBe(true);
    expect(scroller.style.getPropertyValue('--edtr-end-pad'))
      .toBe(`${Math.round(500 * END_PAD_RATIO)}px`);
    surface.setEndPadding(false);
    expect(scroller.classList.contains('edtr-typewriter')).toBe(false);
    expect(scroller.style.getPropertyValue('--edtr-end-pad')).toBe('');
    view.destroy(); scroller.remove();
  });

  // Parity with codeTypewriter.test.ts's equivalent case (the defect fixed in
  // bce8c17): the end padding must be recomputed from the scroller's CURRENT
  // height on every held caret, not frozen at whatever height was live when
  // the mode was switched on.
  it('recomputes end padding on every held caret, so a window resize self-corrects at the next keystroke', () => {
    const scroller = document.createElement('div');
    scroller.className = 'live-view';
    document.body.appendChild(scroller);
    Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true });
    const view = mountIn(scroller, 'hello');
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 0, bottom: 10, left: 0, right: 0 });
    const surface = pmTypewriter(view, () => {});
    surface.setEndPadding(true);
    expect(scroller.style.getPropertyValue('--edtr-end-pad'))
      .toBe(`${Math.round(500 * END_PAD_RATIO)}px`);

    // Simulate the window growing without any toggle of the mode.
    Object.defineProperty(scroller, 'clientHeight', { value: 800, configurable: true });
    surface.holdCaret(HOLD_RATIO);
    expect(scroller.style.getPropertyValue('--edtr-end-pad'))
      .toBe(`${Math.round(800 * END_PAD_RATIO)}px`);
    view.destroy(); scroller.remove();
  });

  it('leaves end padding untouched from holdCaret when the mode is off', () => {
    const scroller = document.createElement('div');
    scroller.className = 'live-view';
    document.body.appendChild(scroller);
    Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true });
    const view = mountIn(scroller, 'hello');
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 0, bottom: 10, left: 0, right: 0 });
    const surface = pmTypewriter(view, () => {});
    // setEndPadding was never called — the mode is off.
    surface.holdCaret(HOLD_RATIO);
    expect(scroller.style.getPropertyValue('--edtr-end-pad')).toBe('');
    expect(scroller.classList.contains('edtr-typewriter')).toBe(false);
    view.destroy(); scroller.remove();
  });
});

/**
 * The HTML schema (HTML Live) — 6c-ii-b Task 2, structural gap G1.
 *
 * `scrollerFor`'s shadow-root walk is already covered above, but with a
 * `liveSchema` document mounted inside the shadow host — which exercises the
 * DOM shape without ever exercising the schema. Nothing in
 * `src/writingmodes/` mounted `htmlSchema` at all before 6c-ii-b, which is
 * the gap that let focus mode's HTML Live defect ship. This closes it for
 * typewriter: a REAL `toLiveHtml` parse, inside a real shadow root, which is
 * production's exact arrangement.
 */
describe('pmTypewriter under the HTML schema, inside a shadow root', () => {
  function mountHtmlInShadow(source: string): { view: EditorView; host: HTMLElement } {
    const res = toLiveHtml(source);
    if (!res.ok) throw new Error(`fixture failed to parse: ${res.reason}`);
    const host = document.createElement('div');
    host.className = 'html-live-view';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const mountPoint = document.createElement('div');
    shadow.appendChild(mountPoint);
    const view = new EditorView(mountPoint, { state: EditorState.create({ doc: res.doc }) });
    return { view, host };
  }

  const SOURCE = '<html><body><h1>Title</h1><div><p>Nested paragraph.</p></div></body></html>';

  it('resolves the scroller out through the shadow host', () => {
    const { view, host } = mountHtmlInShadow(SOURCE);
    expect(scrollerFor(view)).toBe(host);
    view.destroy(); host.remove();
  });

  it('holds the caret line against that scroller, not the shadow mount point', () => {
    const { view, host } = mountHtmlInShadow(SOURCE);
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 40, bottom: 60, left: 0, right: 0 });
    const calls: { scroller: HTMLElement; targetCentreY: number; ratio: number }[] = [];
    pmTypewriter(view, (o) => calls.push(o)).holdCaret(HOLD_RATIO);
    expect(calls).toEqual([{ scroller: host, targetCentreY: 50, ratio: HOLD_RATIO }]);
    view.destroy(); host.remove();
  });

  it('puts the end padding on the shadow HOST, which is the element that scrolls', () => {
    const { view, host } = mountHtmlInShadow(SOURCE);
    Object.defineProperty(host, 'clientHeight', { value: 400, configurable: true });
    const surface = pmTypewriter(view);
    surface.setEndPadding(true);
    expect(host.classList.contains('edtr-typewriter')).toBe(true);
    expect(host.style.getPropertyValue('--edtr-end-pad'))
      .toBe(`${Math.round(400 * END_PAD_RATIO)}px`);
    surface.setEndPadding(false);
    expect(host.classList.contains('edtr-typewriter')).toBe(false);
    view.destroy(); host.remove();
  });

  it('never dispatches a transaction under this schema either (no-beautify)', () => {
    const { view, host } = mountHtmlInShadow(SOURCE);
    const dispatch = vi.spyOn(view, 'dispatch');
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 0, bottom: 10, left: 0, right: 0 });
    const s = pmTypewriter(view, () => {});
    s.holdCaret(HOLD_RATIO);
    s.setEndPadding(true);
    expect(dispatch).not.toHaveBeenCalled();
    view.destroy(); host.remove();
  });
});
