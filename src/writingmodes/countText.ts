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
 * file that shape copied the buffer once, materialised one string per word,
 * and one array element per code point — on every count.
 *
 * Iterates UTF-16 units and pairs surrogates by hand rather than using
 * `for...of` (6c-ii-b Task 7b). `for...of` iterates code points, which is the
 * right unit, but allocates a one-character STRING per position, and the
 * whitespace test it fed — `/\s/.test(ch)` — ran a regex per character.
 * Measured on a 6.4 MB buffer: **125 ms**, against 0.9 ms to materialise the
 * string it was walking, so the walk was the entire cost. This shape does the
 * same job in roughly a third of the time with no allocation per character.
 *
 * The whitespace DEFINITION is unchanged, deliberately: `\s`'s ASCII members
 * are exactly space and U+0009–U+000D, so the fast path tests those directly
 * and anything above 127 still goes through the same `\s` regex. A surrogate
 * pair is one code point and is never whitespace. `countText.test.ts` asserts
 * this against the previous implementation over a corpus rather than trusting
 * the reasoning.
 */
const NON_ASCII_WS = /\s/;

export function countText(text: string): TextCounts {
  let words = 0;
  let characters = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let ws: boolean;
    if (c < 128) {
      // \s ∩ ASCII == {tab, LF, VT, FF, CR} ∪ {space}
      ws = c === 32 || (c >= 9 && c <= 13);
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) i++; // one code point, not two
      ws = false; // no astral character is whitespace
    } else {
      ws = NON_ASCII_WS.test(text[i]);
    }
    characters++;
    if (!ws && !inWord) words++;
    inWord = !ws;
  }
  return { words, characters };
}
