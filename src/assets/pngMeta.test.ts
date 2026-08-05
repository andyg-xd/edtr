import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readPngMeta, hasAlphaChannel, readPixelAlpha } from './pngMeta';

// Committed fixture PNGs inside the repo
const RGB_FIXTURE = resolve(__dirname, './__fixtures__/rgb.png');
const RGBA_FIXTURE = resolve(__dirname, './__fixtures__/rgba.png');

// Known fixture properties (set by generate-fixtures.py)
const RGB_WIDTH = 8;
const RGB_HEIGHT = 8;
const RGB_COLOR_TYPE = 2; // RGB, no alpha

const RGBA_WIDTH = 8;
const RGBA_HEIGHT = 8;
const RGBA_COLOR_TYPE = 6; // RGBA

// Known pixels in the RGBA fixture (set by generate-fixtures.py)
const ALPHA_TRANSPARENT = 0; // Pixel at (0,0)
const ALPHA_OPAQUE = 255; // Pixel at (1,1)
const ALPHA_HALF = 128; // Pixel at (2,2)

describe('readPngMeta', () => {
  it('reads dimensions and colour type from RGB fixture', () => {
    const meta = readPngMeta(readFileSync(RGB_FIXTURE));
    expect(meta.width).toBe(RGB_WIDTH);
    expect(meta.height).toBe(RGB_HEIGHT);
    expect(meta.bitDepth).toBe(8);
    expect(meta.colorType).toBe(RGB_COLOR_TYPE);
  });

  it('reads dimensions and colour type from RGBA fixture', () => {
    const meta = readPngMeta(readFileSync(RGBA_FIXTURE));
    expect(meta.width).toBe(RGBA_WIDTH);
    expect(meta.height).toBe(RGBA_HEIGHT);
    expect(meta.bitDepth).toBe(8);
    expect(meta.colorType).toBe(RGBA_COLOR_TYPE);
  });

  it('rejects a buffer that is not a PNG', () => {
    expect(() => readPngMeta(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a png/i);
  });
});

describe('hasAlphaChannel', () => {
  it('is false for RGB fixture (no alpha channel)', () => {
    expect(hasAlphaChannel(readFileSync(RGB_FIXTURE))).toBe(false);
  });

  it('is true for RGBA fixture (has alpha channel)', () => {
    expect(hasAlphaChannel(readFileSync(RGBA_FIXTURE))).toBe(true);
  });
});

describe('readPixelAlpha', () => {
  it('throws on RGB image rather than returning a wrong number', () => {
    expect(() => readPixelAlpha(readFileSync(RGB_FIXTURE), 0, 0)).toThrow(/rgba/i);
  });

  it('reads transparent pixel (alpha=0) from RGBA fixture', () => {
    const alpha = readPixelAlpha(readFileSync(RGBA_FIXTURE), 0, 0);
    expect(alpha).toBe(ALPHA_TRANSPARENT);
  });

  it('reads fully opaque pixel (alpha=255) from RGBA fixture', () => {
    const alpha = readPixelAlpha(readFileSync(RGBA_FIXTURE), 1, 1);
    expect(alpha).toBe(ALPHA_OPAQUE);
  });

  it('reads partially transparent pixel (alpha=128) from RGBA fixture', () => {
    const alpha = readPixelAlpha(readFileSync(RGBA_FIXTURE), 2, 2);
    expect(alpha).toBe(ALPHA_HALF);
  });
});
