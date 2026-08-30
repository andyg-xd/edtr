import { describe, it, expect } from 'vitest';
import { applyCase } from './preserveCase';

describe('applyCase', () => {
  describe('the three patterns it recognises', () => {
    it('leaves the replacement alone when the match is all lower case', () => {
      expect(applyCase('colour', 'color')).toBe('color');
    });

    it('upper-cases the replacement when the match is all upper case', () => {
      expect(applyCase('COLOUR', 'color')).toBe('COLOR');
    });

    it('capitalises the replacement when the match is capitalised', () => {
      expect(applyCase('Colour', 'color')).toBe('Color');
    });
  });

  describe('what it deliberately does NOT touch', () => {
    it('leaves a mixed-case match alone rather than guessing', () => {
      // camelCase, PascalCase mid-word, sCrEaMiNg -- there is no single right
      // answer, and imposing one silently rewrites text the user did not ask
      // to change.
      expect(applyCase('cOlOuR', 'color')).toBe('color');
      expect(applyCase('colOUR', 'color')).toBe('color');
    });

    it('treats a single upper-case letter as capitalised, not as all-caps', () => {
      // 'A' satisfies both readings. Capitalised is the conservative one: it
      // changes one character of the replacement instead of all of them.
      expect(applyCase('A', 'bcd')).toBe('Bcd');
    });

    it('leaves the replacement alone when the match has no letters at all', () => {
      expect(applyCase('123', 'abc')).toBe('abc');
      expect(applyCase('', 'abc')).toBe('abc');
      expect(applyCase('-- ', 'abc')).toBe('abc');
    });

    it('leaves an empty replacement alone', () => {
      expect(applyCase('COLOUR', '')).toBe('');
    });
  });

  describe('cases that only appear in real documents', () => {
    it('capitalises only the first letter, keeping the rest as typed', () => {
      // The replacement's own internal casing is the user's choice and is not
      // flattened -- only the first letter is touched.
      expect(applyCase('Colour', 'myColor')).toBe('MyColor');
    });

    it('capitalises the first LETTER, not the first character', () => {
      expect(applyCase('Colour', '(color)')).toBe('(Color)');
    });

    it('ignores non-letters when reading the match pattern', () => {
      expect(applyCase("O'BRIEN", 'smith')).toBe('SMITH');
    });

    it("reads a name with internal capitals as mixed, and leaves it alone", () => {
      // O'Brien and McDonald carry TWO capitals, so they are not the
      // "capitalised" shape. This is the mixed rule doing its job: a name the
      // user capitalised deliberately is the worst thing to guess about.
      expect(applyCase("O'Brien", 'smith')).toBe('smith');
      expect(applyCase('McDonald', 'smith')).toBe('smith');
    });

    it('works beyond ASCII', () => {
      expect(applyCase('CAFÉ', 'naive')).toBe('NAIVE');
      expect(applyCase('Café', 'naive')).toBe('Naive');
      expect(applyCase('ÉCOLE', 'school')).toBe('SCHOOL');
    });

    it('is a no-op when the match and replacement are already in the same shape', () => {
      expect(applyCase('cat', 'dog')).toBe('dog');
      expect(applyCase('CAT', 'DOG')).toBe('DOG');
    });
  });
});
