/** A range in one surface's own position space. Inclusive at both ends. */
export interface BlockRange {
  from: number;
  to: number;
}

/** Words and characters for one stretch of text. */
export interface TextCounts {
  words: number;
  characters: number;
}

/**
 * Counts plus WHAT they describe (6c-ii-b, F6).
 *
 * `TextCounts` alone is ambiguous at the point of display: the same pair of
 * numbers means the whole document or just the selection, and the status bar
 * silently swapped between the two with nothing to say so. Kept separate from
 * `TextCounts` so `countText` — a pure function over a string that has no idea
 * where the string came from — is not made to carry a flag it cannot know.
 */
export interface ScopedCounts extends TextCounts {
  /** True when these describe the selection rather than the whole document. */
  isSelection: boolean;
}

/**
 * What the word count needs from an editor.
 *
 * Deliberately NOT an extension of `find/types.ts`'s `FindSurface` (spec §3.3):
 * that interface answers questions about searching, and merging the two would
 * force every future find change to reason about focus mode. The three
 * interfaces here are split by feature for the same reason — a driver
 * implements only what its own task needs.
 */
export interface CountSurface {
  /**
   * The text the count describes (D2): the raw buffer in Code view, the
   * projected document text in Live views. The two legitimately differ, and
   * the number visibly changes across a Code↔Live toggle. That is the decision,
   * not a bug.
   */
  countableText(): string;
  /** The selection's text, or '' when the selection is empty. */
  selectedText(): string;
}

/** What typewriter mode needs from an editor. */
export interface TypewriterSurface {
  /** Scroll so the caret line's vertical centre rests at `ratio` of the scroller's height. */
  holdCaret(ratio: number): void;
  /**
   * Switch the end-of-document scroll padding on or off. When on, the padding
   * is sized to `END_PAD_RATIO` (`1 - HOLD_RATIO`) of the scroller's visible
   * height, so the final line can reach the hold position (D8). The ratio is
   * a fixed design value, not a per-call knob — this used to take the ratio
   * itself (`number | null`), but both drivers ignored whatever value was
   * passed and always used the module constant, so the parameter was pure
   * decoration; narrowed to a boolean to match what the drivers actually do.
   */
  setEndPadding(on: boolean): void;
}

/** What focus mode needs from an editor. */
export interface FocusSurface {
  setFocusEnabled(on: boolean): void;
}
