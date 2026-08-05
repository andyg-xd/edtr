import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readPngMeta, hasAlphaChannel, readPixelAlpha, extractIcnsPngs } from './pngMeta';

// Committed fixture PNGs inside the repo. Both are tiny (8x8) hand-authored
// images: rgb.png is a plain RGB image with no alpha channel at all; rgba.png
// is the same 8x8 canvas but RGBA, with a transparent (0,0), fully opaque
// (1,1), and half-transparent (2,2) pixel deliberately placed so the alpha
// reader can be tested against known, exact values.
const RGB_FIXTURE = resolve(__dirname, './__fixtures__/rgb.png');
const RGBA_FIXTURE = resolve(__dirname, './__fixtures__/rgba.png');

// Known fixture properties
const RGB_WIDTH = 8;
const RGB_HEIGHT = 8;
const RGB_COLOR_TYPE = 2; // RGB, no alpha

const RGBA_WIDTH = 8;
const RGBA_HEIGHT = 8;
const RGBA_COLOR_TYPE = 6; // RGBA

// Known pixels in the RGBA fixture
const ALPHA_TRANSPARENT = 0; // Pixel at (0,0)
const ALPHA_OPAQUE = 255; // Pixel at (1,1)
const ALPHA_HALF = 128; // Pixel at (2,2)

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

  it('rejects a signature-valid buffer too short to contain a full IHDR chunk', () => {
    // 26 bytes: the real PNG signature (8) plus enough filler to reach the
    // bitDepth/colorType offsets (24/25) but NOT the interlace method at
    // offset 28 or the rest of the IHDR chunk. Before the bounds fix, a
    // buffer this short read past its own end and returned undefined
    // fields instead of throwing — indistinguishable from a corrupt file.
    const buf = new Uint8Array(26);
    buf.set(PNG_SIGNATURE, 0);
    expect(() => readPngMeta(buf)).toThrow(/not a png/i);
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

/**
 * Build a synthetic PNG-shaped buffer containing only a signature + IHDR
 * chunk (no IDAT/IEND). Enough for guards that must reject before ever
 * touching pixel data — colour type, bit depth, or interlace method — so
 * these edge cases don't need a real generated fixture image.
 */
function makeIhdrOnlyBuffer(opts: {
  width?: number;
  height?: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}): Uint8Array {
  const { width = 1, height = 1, bitDepth, colorType, interlace } = opts;
  const buf = new Uint8Array(33);
  buf.set(PNG_SIGNATURE, 0);
  buf[8] = 0; buf[9] = 0; buf[10] = 0; buf[11] = 13; // IHDR data length
  buf.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  buf[16] = (width >>> 24) & 0xff;
  buf[17] = (width >>> 16) & 0xff;
  buf[18] = (width >>> 8) & 0xff;
  buf[19] = width & 0xff;
  buf[20] = (height >>> 24) & 0xff;
  buf[21] = (height >>> 16) & 0xff;
  buf[22] = (height >>> 8) & 0xff;
  buf[23] = height & 0xff;
  buf[24] = bitDepth;
  buf[25] = colorType;
  buf[26] = 0; // compression method
  buf[27] = 0; // filter method
  buf[28] = interlace;
  // bytes 29-32 (CRC) are left zero; our reader never checks it.
  return buf;
}

describe('decodeRgba interlace guard', () => {
  it('rejects an Adam7-interlaced PNG rather than decoding garbage', () => {
    const buf = makeIhdrOnlyBuffer({ bitDepth: 8, colorType: 6, interlace: 1 });
    expect(() => readPixelAlpha(buf, 0, 0)).toThrow(/interlace/i);
  });
});

describe('extractIcnsPngs', () => {
  // The real shipped app icon — the artifact macOS actually renders in the
  // Dock. Exercising the parser against it (rather than a synthetic sample)
  // is the point: it is what the appIcon regression test relies on.
  const ICON_ICNS = resolve(__dirname, '../../src-tauri/icons/icon.icns');

  it('extracts multiple embedded PNG payloads from the shipped .icns', () => {
    const images = extractIcnsPngs(readFileSync(ICON_ICNS));
    expect(images.length).toBeGreaterThan(1);
    for (const { data } of images) {
      expect(Array.from(data.subarray(0, 8))).toEqual(PNG_SIGNATURE);
    }
  });

  it('rejects a buffer that is not an icns', () => {
    expect(() => extractIcnsPngs(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not an icns/i);
  });
});
