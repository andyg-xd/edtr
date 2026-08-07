import { describe, it, expect } from 'vitest';
import { compileQuery, emptyQuery, type FindQuery } from './findQuery';

const q = (over: Partial<FindQuery>): FindQuery => ({ ...emptyQuery, ...over });

function source(query: FindQuery, multiline = false): string {
  const r = compileQuery(query, multiline);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.re.source;
}

describe('compileQuery', () => {
  it('reports an empty query as empty, not invalid', () => {
    expect(compileQuery(emptyQuery, false)).toEqual({ ok: false, reason: 'empty' });
  });

  it('escapes regex metacharacters when regex is off', () => {
    // Without escaping, searching for "a.c" would also match "abc" — a silent
    // wrong answer rather than a visible error.
    const re = compileQuery(q({ text: 'a.c' }), false);
    expect(re.ok).toBe(true);
    expect((re as { re: RegExp }).re.test('abc')).toBe(false);
    expect((re as { re: RegExp }).re.test('a.c')).toBe(true);
  });

  it('leaves the pattern alone when regex is on', () => {
    expect(source(q({ text: 'a.c', regex: true }))).toBe('a.c');
  });

  it('RETURNS an invalid pattern instead of throwing', () => {
    // The user is mid-typing "(" every time they type a group. A throw here
    // takes the editor down with them.
    expect(compileQuery(q({ text: '(', regex: true }), false))
      .toEqual({ ok: false, reason: 'invalid' });
  });

  it('is case-insensitive by default and case-sensitive when asked', () => {
    expect(compileQuery(q({ text: 'a' }), false)).toMatchObject({ ok: true });
    const insensitive = compileQuery(q({ text: 'a' }), false);
    const sensitive = compileQuery(q({ text: 'a', matchCase: true }), false);
    expect((insensitive as { re: RegExp }).re.flags).toContain('i');
    expect((sensitive as { re: RegExp }).re.flags).not.toContain('i');
  });

  it('wraps in word boundaries when whole word is on', () => {
    expect(source(q({ text: 'cat', wholeWord: true }))).toBe('\\b(?:cat)\\b');
  });

  it('adds the m flag only for a multiline surface', () => {
    expect((compileQuery(q({ text: 'a' }), true) as { re: RegExp }).re.flags).toContain('m');
    expect((compileQuery(q({ text: 'a' }), false) as { re: RegExp }).re.flags).not.toContain('m');
  });

  it('always compiles with the global flag', () => {
    expect((compileQuery(q({ text: 'a' }), false) as { re: RegExp }).re.flags).toContain('g');
  });
});
