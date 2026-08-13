import { describe, it, expect } from 'vitest';
import { countText } from './countText';

describe('countText', () => {
  it('counts nothing in an empty string', () => {
    expect(countText('')).toEqual({ words: 0, characters: 0 });
  });

  it('counts whitespace as characters but not as a word', () => {
    expect(countText('   \n\t ')).toEqual({ words: 0, characters: 6 });
  });

  it('counts one word', () => {
    expect(countText('hello')).toEqual({ words: 1, characters: 5 });
  });

  it('treats a run of whitespace as a single separator', () => {
    expect(countText('a  b')).toEqual({ words: 2, characters: 4 });
  });

  it('ignores leading and trailing whitespace when counting words', () => {
    expect(countText(' hi ')).toEqual({ words: 1, characters: 4 });
  });

  it('separates words across a newline', () => {
    expect(countText('a\nb')).toEqual({ words: 2, characters: 3 });
  });

  it('counts an astral character as ONE character', () => {
    // "🙂".length is 2 in UTF-16 units. This assertion is the whole reason
    // countText spreads the string instead of reading .length.
    expect(countText('🙂')).toEqual({ words: 1, characters: 1 });
  });

  it('counts an emoji inside a sentence correctly', () => {
    // h,i,SP,🙂,SP,t,h,e,r,e = 10 code points
    expect(countText('hi 🙂 there')).toEqual({ words: 3, characters: 10 });
  });
});
