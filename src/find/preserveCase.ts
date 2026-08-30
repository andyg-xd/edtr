/**
 * Carry a match's capitalisation onto its replacement.
 *
 * Replacing `colour` with `color` should leave `Colour` as `Color` and
 * `COLOUR` as `COLOR`, rather than flattening every occurrence to the exact
 * text typed into the replace field.
 *
 * SEMANTICS (B3, owner 2026-08-29 — the decision this feature always owed).
 * Three patterns are recognised, read from the match's letters only:
 *
 *   all lower case  -> the replacement is used exactly as typed
 *   ALL UPPER CASE  -> the replacement is upper-cased
 *   Capitalised     -> the replacement's first letter is upper-cased
 *   anything else   -> the replacement is used exactly as typed
 *
 * The fourth line is the important one. `cOlOuR` has no single right answer,
 * and imposing one would silently rewrite text in a way the user did not ask
 * for and cannot easily see. Leaving mixed case alone is the only choice that
 * never surprises; it is also what every editor that offers this does.
 *
 * A single upper-case letter satisfies both the all-caps and the capitalised
 * reading. It is treated as capitalised, because that changes one character of
 * the replacement rather than all of them.
 *
 * Non-letters are ignored when reading the pattern, so `O'BRIEN` reads as all
 * caps. `O'Brien` does NOT read as capitalised -- it carries two capitals, so
 * it is mixed and its replacement is left alone. That looks like a gap and is
 * the rule working: a name with internal capitalisation is exactly the case
 * where guessing rewrites something the user chose. This was caught by the
 * tests contradicting an earlier draft of this comment, not by the tests
 * contradicting the code.
 *
 * Only the replacement's first LETTER is touched when capitalising, so
 * `(color)` becomes `(Color)` with its bracket intact and `myColor` becomes
 * `MyColor` with its own internal casing intact.
 */

type Shape = 'lower' | 'upper' | 'capitalised' | 'mixed';

/** Read the capitalisation pattern of a matched string, letters only. */
function shapeOf(matched: string): Shape {
  const letters = Array.from(matched).filter((c) => c.toLowerCase() !== c.toUpperCase());
  if (letters.length === 0) return 'mixed'; // nothing to read — change nothing

  const upper = letters.filter((c) => c === c.toUpperCase());
  if (upper.length === 0) return 'lower';

  // Two or more letters, all upper. One letter alone is 'capitalised' below.
  if (upper.length === letters.length && letters.length > 1) return 'upper';

  // First letter upper and no others: `Colour`, `O'Brien`, `A`.
  if (upper.length === 1 && letters[0] === letters[0].toUpperCase()) return 'capitalised';

  return 'mixed';
}

/** Upper-case the first LETTER, leaving anything before it untouched. */
function capitaliseFirstLetter(text: string): string {
  const chars = Array.from(text);
  const at = chars.findIndex((c) => c.toLowerCase() !== c.toUpperCase());
  if (at === -1) return text;
  chars[at] = chars[at].toUpperCase();
  return chars.join('');
}

/**
 * Apply `matched`'s capitalisation to `replacement`.
 *
 * Pure and surface-agnostic, like the rest of `find/` — one definition of
 * "preserve case" for Code view, Markdown Live and HTML Live alike.
 */
export function applyCase(matched: string, replacement: string): string {
  if (replacement === '') return replacement;
  switch (shapeOf(matched)) {
    case 'upper':
      return replacement.toUpperCase();
    case 'capitalised':
      return capitaliseFirstLetter(replacement);
    case 'lower':
    case 'mixed':
      return replacement;
  }
}
