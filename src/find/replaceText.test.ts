import { describe, it, expect } from 'vitest';
import { expandReplacement, computeReplacements } from './replaceText';
import { emptyQuery } from './findQuery';
import { identityMap, type Segment } from './types';

/** Build a real RegExpExecArray so the tests exercise what production passes in. */
function exec(pattern: string, text: string): RegExpExecArray {
  const m = new RegExp(pattern).exec(text);
  if (!m) throw new Error(`pattern ${pattern} did not match ${text}`);
  return m;
}

/** One whole-document segment, positions == offsets — the Code-view shape. */
const seg = (text: string): Segment[] => [{ text, map: identityMap(text.length) }];

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

describe('computeReplacements', () => {
  it('produces one edit per match, in editor positions', () => {
    const edits = computeReplacements(
      seg('cat and cat'), { ...emptyQuery, text: 'cat' }, 'dog', { multiline: true },
    );
    expect(edits).toEqual([
      { from: 0, to: 3, text: 'dog' },
      { from: 8, to: 11, text: 'dog' },
    ]);
  });

  it('treats $ as a literal dollar when the regex toggle is OFF', () => {
    // The silent-garbage case: replacing "$5" with "$10" must not substitute.
    const edits = computeReplacements(
      seg('costs $5 today'), { ...emptyQuery, text: '$5' }, '$10', { multiline: true },
    );
    expect(edits).toEqual([{ from: 6, to: 8, text: '$10' }]);
  });

  it('substitutes capture groups when the regex toggle is ON', () => {
    const edits = computeReplacements(
      seg('me@here'), { ...emptyQuery, text: '(\\w+)@(\\w+)', regex: true }, '$2 at $1',
      { multiline: true },
    );
    expect(edits).toEqual([{ from: 0, to: 7, text: 'here at me' }]);
  });

  it('keeps user group numbering intact under the whole-word wrapper', () => {
    // compileQuery wraps as \b(?:...)\b — a NON-capturing group, so $1 is still
    // the user's first group. This test is what stops that regressing.
    const edits = computeReplacements(
      seg('say hello there'),
      { ...emptyQuery, text: '(hell)o', regex: true, wholeWord: true }, '$1',
      { multiline: true },
    );
    expect(edits).toEqual([{ from: 4, to: 9, text: 'hell' }]);
  });

  it('returns no edits for an invalid pattern rather than throwing', () => {
    expect(computeReplacements(
      seg('abc'), { ...emptyQuery, text: '(unclosed', regex: true }, 'x', { multiline: true },
    )).toEqual([]);
  });

  it('returns no edits for an empty query', () => {
    expect(computeReplacements(seg('abc'), emptyQuery, 'x', { multiline: true })).toEqual([]);
  });

  it('produces edits that never overlap, in ascending order', () => {
    // spliceSource validates non-overlap and THROWS otherwise, so this is the
    // precondition Replace All depends on (spec 6).
    const edits = computeReplacements(
      seg('aaaa'), { ...emptyQuery, text: 'aa' }, 'b', { multiline: true },
    );
    expect(edits).toEqual([{ from: 0, to: 2, text: 'b' }, { from: 2, to: 4, text: 'b' }]);
    for (let i = 0; i < edits.length - 1; i++) {
      expect(edits[i].to).toBeLessThanOrEqual(edits[i + 1].from);
    }
  });

  it('honours the cap', () => {
    const edits = computeReplacements(
      seg('x'.repeat(50)), { ...emptyQuery, text: 'x' }, 'y', { multiline: true, cap: 10 },
    );
    expect(edits.length).toBe(10);
  });
});
