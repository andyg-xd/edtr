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
 *
 * A single non-allocating pass, not `text.trim()` + `.split(/\s+/)` +
 * `[...text].length`: D2 makes Code view count the RAW buffer, so on a 6 MB
 * file the old shape copied the buffer once, materialised one string per
 * word, and one array element per code point — on every count, every 150 ms
 * while the user types. `for...of` still iterates by code point (so the
 * astral-character behaviour above is unchanged), but visits each one without
 * allocating a backing array.
 */
export function countText(text: string): TextCounts {
  let words = 0;
  let characters = 0;
  let inWord = false;
  for (const ch of text) {
    characters++;
    const ws = /\s/.test(ch);
    if (!ws && !inWord) words++;
    inWord = !ws;
  }
  return { words, characters };
}
