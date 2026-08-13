import type { EditorView } from 'prosemirror-view';
import { scrollToRatio } from './scrollToRatio';
import { END_PAD_RATIO } from './constants';
import type { TypewriterSurface } from './types';

const PAD_VAR = '--edtr-end-pad';
const PAD_CLASS = 'edtr-typewriter';

/** The two Live scrollers defined in canvas.css. */
const SCROLLER_SELECTOR = '.live-view, .html-live-view';

/**
 * The scrolling element for a Live view.
 *
 * HTML Live renders inside a shadow root, so the walk has to step out through
 * the host before `closest` can see the scrolling class. Resolving a NAMED
 * class rather than sniffing computed overflow is deliberate: the class is
 * assertable in jsdom, computed scroll geometry is not.
 */
export function scrollerFor(view: EditorView): HTMLElement | null {
  const root = view.dom.getRootNode();
  const start: Element = root instanceof ShadowRoot ? root.host : view.dom;
  return start.closest(SCROLLER_SELECTOR) as HTMLElement | null;
}

/**
 * Typewriter mode over a Live view — Markdown or HTML, the SAME code for both.
 * Do not add an HTML-specific branch here; that sharing is the design's
 * load-bearing claim and it held for find.
 *
 * Never dispatches: a scroll is a DOM property write and the padding is a CSS
 * variable, so dirty tracking has no transaction to see (no-beautify).
 *
 * `scroll` is injectable, same reason as `codeTypewriter`: jsdom has no
 * layout, so the real scroll is GUI-verified while the plumbing above it is
 * unit-tested here.
 */
export function pmTypewriter(
  view: EditorView,
  scroll: typeof scrollToRatio = scrollToRatio,
): TypewriterSurface {
  // Whether end padding is currently switched on. Tracked here (not read back
  // from the DOM) for the same reason as codeTypewriter: it lets holdCaret
  // tell "recompute" from "leave alone" without a second effect in
  // DocumentView or a ResizeObserver (jsdom has neither layout nor
  // ResizeObserver, so a resize-driven recompute would be untestable there
  // anyway) — holdCaret already runs on every caret move, which in typewriter
  // mode is effectively every keystroke, so a window resize self-corrects at
  // the next keypress instead of staying stale for the rest of the session.
  let padActive = false;

  // Measured in px from the live height rather than expressed in `vh`: the
  // scroller is inset by the ribbon and the document's own padding, so `vh`
  // would over-pad by exactly that inset. Takes the scroller as a parameter
  // rather than re-resolving it: the caller already has it in hand from the
  // same lookup, and a second `scrollerFor` call could in principle resolve a
  // different element if the DOM moved between the two calls.
  function applyPadding(scroller: HTMLElement) {
    scroller.style.setProperty(PAD_VAR, `${Math.round(scroller.clientHeight * END_PAD_RATIO)}px`);
  }

  return {
    holdCaret(ratio) {
      const scroller = scrollerFor(view);
      if (!scroller) return;
      // Keep the padding sized to the scroller's CURRENT height before
      // scrolling, not just at activation — otherwise a resize leaves it
      // pinned to whatever height was live when the mode was switched on.
      // Gated on padActive so this is a no-op (no DOM write at all) when the
      // mode is off, matching holdCaret's contract of doing nothing but
      // scrolling in that case.
      if (padActive) applyPadding(scroller);
      const head = view.state.selection.head;
      // Unlike find's equivalent guard (pmSurface.ts), which is genuinely
      // load-bearing because a stale match position CAN outlive the document
      // version it was computed against, this one is not reachable in
      // practice: ProseMirror's own invariants keep `selection.head` inside
      // `[0, doc.content.size]` at all times. Kept as a cheap defensive check
      // in front of `coordsAtPos` (which throws on an out-of-range position)
      // rather than as a claim that it protects against something that can
      // actually happen here.
      if (head < 0 || head > view.state.doc.content.size) return;
      const coords = view.coordsAtPos(head);
      // Null when the position is not currently rendered. Declining beats
      // guessing a coordinate and scrolling somewhere arbitrary.
      if (!coords) return;
      scroll({ scroller, targetCentreY: (coords.top + coords.bottom) / 2, ratio });
    },
    setEndPadding(on) {
      const scroller = scrollerFor(view);
      if (!scroller) return;
      if (!on) {
        padActive = false;
        scroller.classList.remove(PAD_CLASS);
        scroller.style.removeProperty(PAD_VAR);
        return;
      }
      padActive = true;
      applyPadding(scroller);
      scroller.classList.add(PAD_CLASS);
    },
  };
}
