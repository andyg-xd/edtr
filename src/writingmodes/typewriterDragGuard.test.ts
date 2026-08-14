// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditorState as CmState } from '@codemirror/state';
import { EditorView as CmView } from '@codemirror/view';
import { EditorState as PmState, TextSelection } from 'prosemirror-state';
import { EditorView as PmView } from 'prosemirror-view';
import { liveSchema } from '../views/liveSchema';
import { pmTypewriter } from './pmTypewriter';
import { codeTypewriter } from './codeTypewriter';
import { isPointerDown, resetPointerStateForTests, subscribePointerRelease } from './pointerState';
import { HOLD_RATIO } from './constants';

/**
 * Typewriter must not scroll during a drag, or for a range selection
 * (6c-ii-b, F1).
 *
 * The defect: `holdCaret` runs on every selection change and ends in a
 * `scrollTop` write. A drag-select changes the selection on every pointer
 * move, so the scroll moves content out from under the held pointer, which
 * extends the selection further, which fires another hold — a feedback loop
 * that selected large runs of text and looked broken. The owner's proposed fix
 * was a small delay; a delay cannot fix a feedback loop, only slow it, which
 * is why the guards are conditional rather than temporal.
 *
 * Asserted on BOTH drivers rather than one: the two surfaces have separate
 * implementations (CodeMirror's scroller vs. the Live views' shared one), so a
 * guard added to one proves nothing about the other.
 */

function pmSetup(text: string) {
  const scroller = document.createElement('div');
  scroller.className = 'live-view';
  document.body.appendChild(scroller);
  const doc = liveSchema.node('doc', null, [
    liveSchema.node('paragraph', { blockId: 'b0' }, [liveSchema.text(text)]),
  ]);
  const view = new PmView(scroller, { state: PmState.create({ doc }) });
  vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 60, bottom: 80, left: 0, right: 0 });
  const calls: unknown[] = [];
  const surface = pmTypewriter(view, (o) => calls.push(o));
  return { view, surface, calls, cleanup: () => { view.destroy(); scroller.remove(); } };
}

function cmSetup(text: string) {
  const view = new CmView({ state: CmState.create({ doc: text }) });
  vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 60, bottom: 80, left: 0, right: 0 });
  const calls: unknown[] = [];
  const surface = codeTypewriter(view, (o) => calls.push(o));
  return { view, surface, calls, cleanup: () => view.destroy() };
}

beforeEach(() => {
  resetPointerStateForTests();
});

describe('pointerState', () => {
  it('tracks a press and release', () => {
    expect(isPointerDown()).toBe(false);
    window.dispatchEvent(new Event('pointerdown'));
    expect(isPointerDown()).toBe(true);
    window.dispatchEvent(new Event('pointerup'));
    expect(isPointerDown()).toBe(false);
  });

  it('unlatches on blur, so a release outside the window cannot wedge it', () => {
    // Without this the flag latches on and typewriter silently stops holding
    // for the rest of the session — a worse and less visible failure than the
    // one being fixed.
    window.dispatchEvent(new Event('pointerdown'));
    expect(isPointerDown()).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(isPointerDown()).toBe(false);
  });

  it('unlatches on pointercancel', () => {
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('pointercancel'));
    expect(isPointerDown()).toBe(false);
  });
});

describe.each([
  ['Live view (pmTypewriter)', pmSetup],
  ['Code view (codeTypewriter)', cmSetup],
])('%s — drag guard', (_label, setup) => {
  it('holds normally for a collapsed caret with no pointer down', () => {
    // The positive control. Without this the suppression tests below could all
    // pass against a surface that simply never scrolls.
    const { surface, calls, cleanup } = setup('hello there');
    surface.holdCaret(HOLD_RATIO);
    expect(calls).toHaveLength(1);
    cleanup();
  });

  it('does NOT scroll while a pointer is held down', () => {
    const { surface, calls, cleanup } = setup('hello there');
    window.dispatchEvent(new Event('pointerdown'));
    surface.holdCaret(HOLD_RATIO);
    surface.holdCaret(HOLD_RATIO);
    surface.holdCaret(HOLD_RATIO);
    expect(calls, 'a drag must produce no scrolls at all').toHaveLength(0);
    cleanup();
  });

  it('resumes holding once the pointer is released', () => {
    const { surface, calls, cleanup } = setup('hello there');
    window.dispatchEvent(new Event('pointerdown'));
    surface.holdCaret(HOLD_RATIO);
    expect(calls).toHaveLength(0);
    window.dispatchEvent(new Event('pointerup'));
    surface.holdCaret(HOLD_RATIO);
    expect(calls, 'the guard must be transient, not a permanent disable').toHaveLength(1);
    cleanup();
  });
});

describe('range selections never hold', () => {
  it('Live view: a non-collapsed selection does not scroll', () => {
    // Covers selection by keyboard (⇧↓), which touches no pointer at all, so
    // the pointer guard alone would miss it.
    const { view, surface, calls, cleanup } = pmSetup('hello there');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
    surface.holdCaret(HOLD_RATIO);
    expect(calls).toHaveLength(0);
    // Collapsing it again re-arms the hold.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 1)));
    surface.holdCaret(HOLD_RATIO);
    expect(calls).toHaveLength(1);
    cleanup();
  });

  it('Code view: a non-collapsed selection does not scroll', () => {
    const { view, surface, calls, cleanup } = cmSetup('hello there');
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    surface.holdCaret(HOLD_RATIO);
    expect(calls).toHaveLength(0);
    view.dispatch({ selection: { anchor: 3, head: 3 } });
    surface.holdCaret(HOLD_RATIO);
    expect(calls).toHaveLength(1);
    cleanup();
  });
});

describe('re-arming on release (the regression the first drag guard shipped)', () => {
  it('notifies release subscribers on pointerup, pointercancel and blur', () => {
    const seen: string[] = [];
    const un = subscribePointerRelease(() => seen.push('release'));
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('pointerup'));
    expect(seen).toHaveLength(1);
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('pointercancel'));
    expect(seen).toHaveLength(2);
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('blur'));
    expect(seen).toHaveLength(3);
    un();
    window.dispatchEvent(new Event('pointerup'));
    expect(seen, 'unsubscribe must actually detach').toHaveLength(3);
  });

  it('a PLAIN CLICK holds the caret line, via the release', () => {
    // The exact defect found in GUI validation. A click changes the selection
    // on pointerdown, which the drag guard suppresses, and pointerup carries
    // no selection change — so without the re-arm nothing holds for a click at
    // all, and the first keystroke then lurches the viewport the whole way.
    //
    // Mirrors DocumentView's wiring: subscribe holdCaret to the release.
    const { surface, calls, cleanup } = pmSetup('hello there');
    const un = subscribePointerRelease(() => surface.holdCaret(HOLD_RATIO));

    window.dispatchEvent(new Event('pointerdown'));
    surface.holdCaret(HOLD_RATIO);          // the click's own selection change
    expect(calls, 'suppressed while the button is down').toHaveLength(0);

    window.dispatchEvent(new Event('pointerup'));
    expect(calls, 'the release must hold from the final caret position').toHaveLength(1);

    un();
    cleanup();
  });

  it('finishing a drag-select on a RANGE still holds nothing', () => {
    // The release fires for a drag too, so the collapsed-selection guard is
    // what stops a completed drag-select from scrolling. Without it this fix
    // would have reintroduced a jump at the end of every drag.
    const { view, surface, calls, cleanup } = pmSetup('hello there');
    const un = subscribePointerRelease(() => surface.holdCaret(HOLD_RATIO));

    window.dispatchEvent(new Event('pointerdown'));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
    surface.holdCaret(HOLD_RATIO);
    window.dispatchEvent(new Event('pointerup'));

    expect(calls, 'a completed drag-select must not scroll').toHaveLength(0);
    un();
    cleanup();
  });
});
