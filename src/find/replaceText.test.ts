import { describe, it, expect } from 'vitest';
import { expandReplacement } from './replaceText';

/** Build a real RegExpExecArray so the tests exercise what production passes in. */
function exec(pattern: string, text: string): RegExpExecArray {
  const m = new RegExp(pattern).exec(text);
  if (!m) throw new Error(`pattern ${pattern} did not match ${text}`);
  return m;
}

describe('expandReplacement', () => {
  it('returns a template with no dollar signs unchanged', () => {
    expect(expandReplacement(exec('cat', 'a cat here'), 'dog')).toBe('dog');
  });

  it('substitutes numbered capture groups', () => {
    expect(expandReplacement(exec('(\\w+)@(\\w+)', 'me@here'), '$2 at $1')).toBe('here at me');
  });

  it('substitutes a two-digit group before falling back to one digit', () => {
    // With 11 groups, $11 is group 11 (two-digit form).
    const m11 = exec('(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)', 'abcdefghijk');
    expect(expandReplacement(m11, '$11')).toBe('k');

    // With only 1 group, $11 is group 1 followed by literal '1' (one-digit fallback).
    const m1 = exec('(a)', 'a');
    expect(expandReplacement(m1, '$11')).toBe('a1');
  });

  it('leaves a group reference with no such group as literal text', () => {
    // Matches String.replace: $9 with only two groups is not a group reference.
    expect(expandReplacement(exec('(a)(b)', 'ab'), '$9')).toBe('$9');
  });

  it('substitutes the whole match, the prefix and the suffix', () => {
    const m = exec('cat', 'a cat here');
    expect(expandReplacement(m, '[$&]')).toBe('[cat]');
    expect(expandReplacement(m, '[$`]')).toBe('[a ]');
    expect(expandReplacement(m, "[$']")).toBe('[ here]');
  });

  it('unescapes $$ to a single literal dollar', () => {
    expect(expandReplacement(exec('x', 'x'), '$$5')).toBe('$5');
  });

  it('treats an unmatched optional group as empty', () => {
    expect(expandReplacement(exec('a(b)?', 'a'), '[$1]')).toBe('[]');
  });
});
