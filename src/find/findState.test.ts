import { describe, it, expect } from 'vitest';
import {
  emptyFindState, setResult, next, prev, clear, currentMatch, countLabel,
} from './findState';
import { emptyQuery, type FindQuery } from './findQuery';
import type { MatchRun } from './matchText';

const q = (over: Partial<FindQuery>): FindQuery => ({ ...emptyQuery, ...over });
const run = (froms: number[], over: Partial<MatchRun> = {}): MatchRun => ({
  matches: froms.map((from) => ({ from, to: from + 3 })),
  capped: false,
  invalid: false,
  ...over,
});

describe('setResult', () => {
  it('starts at the first match at or after the cursor', () => {
    // Search starts where the user is looking, not at the top of the file.
    const s = setResult(emptyFindState, q({ text: 'a' }), run([0, 10, 20]), 10);
    expect(s.current).toBe(1);
  });

  it('wraps to the first match when the cursor is past the last one', () => {
    const s = setResult(emptyFindState, q({ text: 'a' }), run([0, 10]), 99);
    expect(s.current).toBe(0);
  });

  it('starts at the top when no cursor is given', () => {
    expect(setResult(emptyFindState, q({ text: 'a' }), run([5, 9])).current).toBe(0);
  });

  it('has no current match when nothing matched', () => {
    const s = setResult(emptyFindState, q({ text: 'zz' }), run([]));
    expect(s.current).toBe(-1);
    expect(currentMatch(s)).toBeNull();
  });

  it('carries capped and invalid through', () => {
    const s = setResult(emptyFindState, q({ text: '(' }), run([], { invalid: true }));
    expect(s.invalid).toBe(true);
    const c = setResult(emptyFindState, q({ text: 'a' }), run([0], { capped: true }));
    expect(c.capped).toBe(true);
  });
});

describe('next / prev', () => {
  const base = setResult(emptyFindState, q({ text: 'a' }), run([0, 10, 20]));

  it('advances', () => {
    expect(next(base).current).toBe(1);
  });

  it('wraps forward past the end', () => {
    expect(next(next(next(base))).current).toBe(0);
  });

  it('wraps backward past the start', () => {
    expect(prev(base).current).toBe(2);
  });

  it('does nothing when there are no matches', () => {
    const none = setResult(emptyFindState, q({ text: 'z' }), run([]));
    expect(next(none)).toBe(none);
    expect(prev(none)).toBe(none);
  });
});

describe('clear', () => {
  it('drops the matches but keeps the query, so reopening keeps the term', () => {
    const s = setResult(emptyFindState, q({ text: 'a' }), run([0, 10]));
    const c = clear(s);
    expect(c.matches).toEqual([]);
    expect(c.current).toBe(-1);
    expect(c.query.text).toBe('a');
  });
});

describe('countLabel', () => {
  it('shows position out of total', () => {
    expect(countLabel(setResult(emptyFindState, q({ text: 'a' }), run([0, 10, 20])))).toBe('1/3');
  });

  it('says No results in plain language', () => {
    expect(countLabel(setResult(emptyFindState, q({ text: 'z' }), run([])))).toBe('No results');
  });

  it('says Invalid pattern rather than No results', () => {
    // These are different problems and the user fixes them differently.
    expect(countLabel(setResult(emptyFindState, q({ text: '(' }), run([], { invalid: true }))))
      .toBe('Invalid pattern');
  });

  it('is empty when nothing has been typed', () => {
    expect(countLabel(emptyFindState)).toBe('');
  });

  it('marks a capped total with a trailing +', () => {
    const s = setResult(emptyFindState, q({ text: 'a' }), run([0, 10], { capped: true }));
    expect(countLabel(s)).toBe('1/2+');
  });
});
