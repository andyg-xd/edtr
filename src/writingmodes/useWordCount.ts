import { useEffect, useState } from 'react';
import { countText } from './countText';
import type { CountSurface, TextCounts } from './types';

/** Debounce in milliseconds (spec §4.3). Exact, so a test can assert it. */
export const COUNT_DEBOUNCE_MS = 150;

/**
 * Debounced words and characters for the active surface.
 *
 * `version` is any value that changes when the document or selection changes —
 * `DocumentView` already maintains such counters for find, so this rides an
 * existing signal instead of adding a second change subscription.
 *
 * Trailing-edge only: in a Live view each count allocates the document's whole
 * text, and doing that per keystroke is waste for a number nobody reads
 * mid-word. The visible cost is that the count can lag one keystroke, which is
 * the intended trade (spec §4.3), not a defect.
 */
export function useWordCount(surface: CountSurface | null, version: number): TextCounts | null {
  const [counts, setCounts] = useState<TextCounts | null>(null);

  useEffect(() => {
    if (!surface) { setCounts(null); return; }
    const t = setTimeout(() => {
      const selected = surface.selectedText();
      setCounts(countText(selected === '' ? surface.countableText() : selected));
    }, COUNT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [surface, version]);

  return counts;
}
