import type { EditorView } from '@codemirror/view';
import { scrollToRatio } from './scrollToRatio';
import { END_PAD_RATIO } from './constants';
import type { TypewriterSurface } from './types';

const PAD_VAR = '--edtr-end-pad';
const PAD_CLASS = 'cm-edtr-typewriter';

/**
 * Typewriter mode over Code view.
 *
 * `scroll` is injectable so the wiring can be tested without a layout engine:
 * jsdom reports every rect as zero and does not honour `scrollTop`, so the real
 * scroll is GUI-verified (matrix item 1) while the plumbing above it is not.
 *
 * Note this surface NEVER dispatches: scrolling is a DOM property write and the
 * padding is a CSS variable, so no transaction exists for dirty tracking to
 * see. That is the no-beautify story for this feature, asserted by test.
 */
export function codeTypewriter(
  view: EditorView,
  scroll: typeof scrollToRatio = scrollToRatio,
): TypewriterSurface {
  // Whether end padding is currently switched on. Tracked here (not read back
  // from the DOM) so holdCaret can tell "recompute" from "leave alone" without
  // a second effect in DocumentView or a ResizeObserver (jsdom has neither
  // layout nor ResizeObserver, so a resize-driven recompute would be
  // untestable there anyway): holdCaret already runs on every caret move,
  // which in typewriter mode is effectively every keystroke, so a window
  // resize self-corrects at the next keypress instead of staying stale for
  // the rest of the session.
  let padActive = false;

  // Measured in px from the live height rather than expressed in `vh`: the
  // editor is inset by the chrome and the status bar, so `vh` would over-pad
  // by exactly that inset.
  function applyPadding() {
    view.scrollDOM.style.setProperty(PAD_VAR, `${Math.round(view.scrollDOM.clientHeight * END_PAD_RATIO)}px`);
  }

  return {
    holdCaret(ratio) {
      // Keep the padding sized to the scroller's CURRENT height before
      // scrolling, not just at activation -- otherwise a resize leaves it
      // pinned to whatever height was live when the mode was switched on.
      // Gated on padActive so this is a no-op (no DOM write at all) when the
      // mode is off, matching holdCaret's contract of doing nothing but
      // scrolling in that case.
      if (padActive) applyPadding();
      const coords = view.coordsAtPos(view.state.selection.main.head);
      // Null when the position is not currently rendered. Declining beats
      // guessing a coordinate and scrolling somewhere arbitrary.
      if (!coords) return;
      scroll({
        scroller: view.scrollDOM,
        targetCentreY: (coords.top + coords.bottom) / 2,
        ratio,
      });
    },
    setEndPadding(on) {
      const el = view.scrollDOM;
      if (!on) {
        padActive = false;
        el.classList.remove(PAD_CLASS);
        el.style.removeProperty(PAD_VAR);
        return;
      }
      padActive = true;
      applyPadding();
      el.classList.add(PAD_CLASS);
    },
  };
}
