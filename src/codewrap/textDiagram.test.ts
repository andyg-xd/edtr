import { describe, it, expect } from 'vitest';
import { isTextDiagram } from './textDiagram';

describe('isTextDiagram', () => {
  it('two lines with box-drawing characters is a diagram', () =>
    expect(isTextDiagram('┌──┐\n│ A │\n└──┘')).toBe(true));
  it('one separator line is not', () =>
    expect(isTextDiagram('// ─────────\nconst a = 1;')).toBe(false));
  it('ASCII-only art is not', () =>
    expect(isTextDiagram('+--+\n|A |\n+--+')).toBe(false));
  it('empty is not', () => expect(isTextDiagram('')).toBe(false));
  it('counts lines, not characters', () =>
    expect(isTextDiagram('──────────')).toBe(false));
  it('handles CRLF', () => expect(isTextDiagram('│a\r\n│b')).toBe(true));
  it('the range ends at U+257F', () =>
    expect(isTextDiagram('▶ a\n▶ b')).toBe(false)); // U+25B6 is outside
});
