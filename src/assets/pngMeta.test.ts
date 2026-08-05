import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readPngMeta, hasAlphaChannel, readPixelAlpha } from './pngMeta';

// The user's original source: 1254x1254, RGB (colour type 2), NO alpha.
// This is the exact file whose opacity would have shipped a black square.
const ORIGINAL = resolve(__dirname, '../../../project-docs/brand-assets/Edtr.png');

describe('readPngMeta', () => {
  it('reads dimensions and colour type from IHDR', () => {
    const meta = readPngMeta(readFileSync(ORIGINAL));
    expect(meta.width).toBe(1254);
    expect(meta.height).toBe(1254);
    expect(meta.bitDepth).toBe(8);
    expect(meta.colorType).toBe(2); // 2 = truecolour, no alpha
  });

  it('rejects a buffer that is not a PNG', () => {
    expect(() => readPngMeta(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a png/i);
  });
});

describe('hasAlphaChannel', () => {
  it('is false for the original opaque RGB source', () => {
    expect(hasAlphaChannel(readFileSync(ORIGINAL))).toBe(false);
  });
});

describe('readPixelAlpha', () => {
  it('throws on a non-RGBA image rather than returning a wrong number', () => {
    expect(() => readPixelAlpha(readFileSync(ORIGINAL), 0, 0)).toThrow(/rgba/i);
  });
});
