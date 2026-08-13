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
  return {
    holdCaret(ratio) {
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
    setEndPadding(ratio) {
      const el = view.scrollDOM;
      if (ratio === null) {
        el.classList.remove(PAD_CLASS);
        el.style.removeProperty(PAD_VAR);
        return;
      }
      // Measured in px from the live height rather than expressed in `vh`:
      // the editor is inset by the chrome and the status bar, so `vh` would
      // over-pad by exactly that inset.
      el.style.setProperty(PAD_VAR, `${Math.round(el.clientHeight * END_PAD_RATIO)}px`);
      el.classList.add(PAD_CLASS);
    },
  };
}
