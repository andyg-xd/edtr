import { useEffect, useState } from 'react';
import { countText } from './countText';
import type { CountSurface, ScopedCounts } from './types';

/** Debounce in milliseconds (spec §4.3). Exact, so a test can assert it. */
export const COUNT_DEBOUNCE_MS = 150;

/**
 * Debounced words and characters for the active surface.
 *
 * `version` is any value that changes when the document or selection changes —
 * `DocumentView` already maintains such counters for find, so this rides an
 * existing signal instead of adding a second change subscription. Deliberately
 * NOT typed as `number`: it is only ever compared by identity as an effect
 * dependency, never read, so `DocumentView` can hand this a memoized composite
 * key (e.g. a template string of several of its own signals) instead of
 * contorting several independent counters into one arithmetic value.
 *
 * Trailing-edge only: in a Live view each count allocates the document's whole
 * text, and doing that per keystroke is waste for a number nobody reads
 * mid-word. The visible cost is that the count can lag one keystroke, which is
 * the intended trade (spec §4.3), not a defect.
 */
export function useWordCount(surface: CountSurface | null, version: unknown): ScopedCounts | null {
  const [counts, setCounts] = useState<ScopedCounts | null>(null);

  useEffect(() => {
    if (!surface) { setCounts(null); return; }
    const t = setTimeout(() => {
      // The hook already distinguishes these two cases in order to choose what
      // to count; it simply used to throw the distinction away. Reporting it is
      // what lets the bar say which one the numbers describe (F6).
      const selected = surface.selectedText();
      const isSelection = selected !== '';
      setCounts({
        ...countText(isSelection ? selected : surface.countableText()),
        isSelection,
      });
    }, COUNT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [surface, version]);

  return counts;
}
