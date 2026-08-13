/**
 * Where typewriter mode holds the caret line: the line's vertical CENTRE rests
 * at this fraction of the scroller's visible height (D7, spec §5.1).
 *
 * Just above centre. Dead centre spends half the window on text already
 * written; the upper third leaves the caret hanging while drafting into empty
 * space. Not user-configurable (spec §9).
 */
export const HOLD_RATIO = 0.42;

/** Scroll padding below the last line, as a fraction of the scroller (D8). */
export const END_PAD_RATIO = 1 - HOLD_RATIO;
