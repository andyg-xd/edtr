import { describe, it, expect } from 'vitest';
import { matchText, matchSegments, MATCH_CAP } from './matchText';
import { emptyQuery, type FindQuery } from './findQuery';
import { identityMap, type Segment } from './types';

const q = (over: Partial<FindQuery>): FindQuery => ({ ...emptyQuery, ...over });
const seg = (text: string): Segment => ({ text, map: identityMap(text.length) });

describe('matchText', () => {
  it('finds every non-overlapping match in order', () => {
    expect(matchText('abcabc', /abc/g)).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
    ]);
  });

  it('finds adjacent and repeated matches', () => {
    expect(matchText('aaa', /a/g)).toEqual([
      { start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 },
    ]);
  });

  it('DROPS zero-length matches instead of hanging', () => {
    // `a*` matches empty at every position. Without the guard the loop never
    // advances and the app locks up; an empty highlight is also nothing the
    // user could see or navigate to.
    expect(matchText('bbb', /a*/g)).toEqual([]);
  });

  it('steps past a zero-length match to find a real one after it', () => {
    expect(matchText('bab', /a*/g)).toEqual([{ start: 1, end: 2 }]);
  });

  it('returns nothing for text with no match', () => {
    expect(matchText('abc', /z/g)).toEqual([]);
  });
});

describe('matchSegments', () => {
  it('maps matches into editor positions', () => {
    const run = matchSegments([seg('hello world')], q({ text: 'world' }), { multiline: true });
    expect(run).toEqual({ matches: [{ from: 6, to: 11 }], capped: false, invalid: false });
  });

  it('never lets a match cross a segment boundary', () => {
    // "lo" + "ve" would match "love" if the segments were concatenated. They
    // are not, and that guarantee is structural rather than checked.
    const run = matchSegments([seg('lo'), seg('ve')], q({ text: 'love' }), { multiline: false });
    expect(run.matches).toEqual([]);
  });

  it('searches every segment, in order', () => {
    const run = matchSegments([seg('cat'), seg('cat')], q({ text: 'cat' }), { multiline: false });
    expect(run.matches.length).toBe(2);
  });

  it('reports an invalid pattern rather than matching nothing silently', () => {
    const run = matchSegments([seg('abc')], q({ text: '(', regex: true }), { multiline: false });
    expect(run).toEqual({ matches: [], capped: false, invalid: true });
  });

  it('reports an empty query as neither invalid nor matching', () => {
    const run = matchSegments([seg('abc')], emptyQuery, { multiline: false });
    expect(run).toEqual({ matches: [], capped: false, invalid: false });
  });

  it('caps the match list and says so', () => {
    const run = matchSegments([seg('a'.repeat(20))], q({ text: 'a' }), { multiline: false, cap: 5 });
    expect(run.matches.length).toBe(5);
    expect(run.capped).toBe(true);
  });

  it('defaults the cap to MATCH_CAP', () => {
    expect(MATCH_CAP).toBe(5000);
  });

  it('honours whole word across segments', () => {
    const run = matchSegments([seg('cat'), seg('cats')], q({ text: 'cat', wholeWord: true }), { multiline: false });
    expect(run.matches).toEqual([{ from: 0, to: 3 }]);
  });

  it('anchors ^ per line when multiline, per segment when not', () => {
    const two = [seg('one\ntwo')];
    expect(matchSegments(two, q({ text: '^t', regex: true }), { multiline: true }).matches.length).toBe(1);
    expect(matchSegments(two, q({ text: '^t', regex: true }), { multiline: false }).matches.length).toBe(0);
  });
});
