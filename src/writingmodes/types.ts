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
   * Add scroll padding below the last line, sized to `1 - ratio` of the
   * scroller's visible height, so the final line can reach the hold position
   * (D8). Passing null removes the padding entirely.
   */
  setEndPadding(ratio: number | null): void;
}

/** What focus mode needs from an editor. */
export interface FocusSurface {
  setFocusEnabled(on: boolean): void;
}
