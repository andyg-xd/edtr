import { describe, it, expect } from 'vitest';
import { countText } from './countText';

/**
 * Equivalence with the previous implementation (6c-ii-b Task 7b).
 *
 * `countText` was rewritten for speed — UTF-16 iteration with hand-paired
 * surrogates and a direct ASCII whitespace test, instead of `for...of` plus
 * `/\s/.test(ch)`. That optimisation is only legitimate if the ANSWER is
 * identical, and "I reasoned about which characters `\s` matches" is exactly
 * the kind of claim that is wrong in one corner and silently changes a number
 * the user reads.
 *
 * So the OLD implementation is kept here verbatim as a reference oracle and
 * the two are compared over a corpus chosen for the corners: astral
 * characters, lone surrogates, CJK, every ASCII control in and around the
 * `\s` range, and the non-ASCII spaces `\s` also matches.
 */
function referenceCountText(text: string): { words: number; characters: number } {
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

const CORPUS: [string, string][] = [
  ['empty', ''],
  ['plain prose', 'the quick brown fox'],
  ['leading and trailing whitespace', '   padded   '],
  ['tabs and newlines', 'a\tb\nc\r\ndef'],
  ['CR LF VT FF', 'abc\r\nd'],
  // 0x00-0x20 interleaved: covers both the \s members (9-13, 32) and the
  // controls either side of them, which must NOT count as whitespace.
  ['every ASCII control 0x00-0x20', Array.from({ length: 33 }, (_, i) => String.fromCharCode(i)).join('x')],
  ['emoji', 'hello \u{1F642} world done'],
  ['ZWJ family sequence', 'a \u{1F468}‍\u{1F469}‍\u{1F467} b'],
  ['astral only', '\u{1F642}\u{1F642}\u{1F642}'],
  ['CJK sentence', '早安，今天天气很好 ☀️'],
  ['ideographic + nbsp + BOM spaces', 'a b　c﻿d e'],
  ['unicode line separators', 'a b c'],
  ['lone high surrogate', 'a\uD800b'],
  ['lone low surrogate', 'a\uDC00b'],
  ['high surrogate at end of string', 'ab\uD83D'],
  ['low surrogate at start', '\uDC00ab'],
  ['mixed', '  \u{1F642} tab\there\n\n早安 x y  '],
  ['markdown-ish', '# Heading\n\n- item one\n- item two\n\n`code` **bold**\n'],
];

describe('countText matches the previous implementation exactly', () => {
  it.each(CORPUS)('%s', (_label, text) => {
    expect(countText(text)).toEqual(referenceCountText(text));
  });

  it('agrees on a large generated buffer — the case the rewrite exists for', () => {
    const row = 'const value = compute(alpha, bravo) + "a \u{1F642} literal"; // 早安 note';
    const big = Array.from({ length: 2000 }, (_, i) => `${row} ${i}`).join('\n');
    expect(countText(big)).toEqual(referenceCountText(big));
  });

  it('the oracle is a real check, not a mirror of the thing it checks', () => {
    // Guards the whole file against passing because both sides resolved to the
    // same function: the reference must produce known-correct values on its own.
    expect(referenceCountText('a b')).toEqual({ words: 2, characters: 3 });
    expect(referenceCountText('\u{1F642}')).toEqual({ words: 1, characters: 1 });
    expect(referenceCountText('  ')).toEqual({ words: 0, characters: 2 });
  });
});
