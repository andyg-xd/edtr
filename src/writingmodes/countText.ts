import type { TextCounts } from './types';

/**
 * Words and characters for a stretch of text.
 *
 * A word is a run of non-whitespace (spec §4.2). Characters are counted by
 * CODE POINT, not UTF-16 unit — `"🙂".length` is 2 and the count must say 1.
 * Whitespace counts as characters, which is what a character count means
 * everywhere else.
 *
 * Known limitation, recorded in spec §10 rather than hidden: whitespace-based
 * counting makes a Chinese or Japanese sentence a single word. A per-script
 * rule is out of scope and needs its own decision.
 */
export function countText(text: string): TextCounts {
  const trimmed = text.trim();
  return {
    words: trimmed === '' ? 0 : trimmed.split(/\s+/).length,
    characters: [...text].length,
  };
}
