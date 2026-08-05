import { inflateSync } from 'node:zlib';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface PngMeta {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
}

function assertSignature(buf: Uint8Array): void {
  if (buf.length < 24) throw new Error('not a png: too short');
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new Error('not a png: bad signature');
  }
}

function readU32(buf: Uint8Array, off: number): number {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

/** IHDR is always the first chunk and has a fixed layout, so these offsets are safe. */
export function readPngMeta(buf: Uint8Array): PngMeta {
  assertSignature(buf);
  return {
    width: readU32(buf, 16),
    height: readU32(buf, 20),
    bitDepth: buf[24],
    colorType: buf[25],
  };
}

export function hasAlphaChannel(buf: Uint8Array): boolean {
  const { colorType } = readPngMeta(buf);
  return colorType === 4 || colorType === 6;
}

/** Concatenate every IDAT chunk's payload, in file order. */
function collectIdat(buf: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let off = 8; // past the signature
  while (off + 8 <= buf.length) {
    const len = readU32(buf, off);
    const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
    if (type === 'IDAT') parts.push(buf.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len; // length + type + data + crc
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Decode 8-bit RGBA pixel data. Each scanline is one filter byte followed by
 * width*4 bytes; filters are reversed in place against the previous row.
 */
function decodeRgba(buf: Uint8Array): { width: number; height: number; data: Uint8Array } {
  const { width, height, bitDepth, colorType } = readPngMeta(buf);
  if (colorType !== 6 || bitDepth !== 8) {
    throw new Error(`expected 8-bit RGBA (colour type 6), got colour type ${colorType} depth ${bitDepth}`);
  }
  const raw = new Uint8Array(inflateSync(collectIdat(buf)));
  const bpp = 4;
  const stride = width * bpp;
  const data = new Uint8Array(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[pos + i];
      const a = i >= bpp ? data[rowStart + i - bpp] : 0;
      const b = y > 0 ? data[prevStart + i] : 0;
      const c = i >= bpp && y > 0 ? data[prevStart + i - bpp] : 0;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error(`unknown png filter ${filter} on row ${y}`);
      }
      data[rowStart + i] = v & 0xff;
    }
    pos += stride;
  }
  return { width, height, data };
}

export function readPixelAlpha(buf: Uint8Array, x: number, y: number): number {
  const { width, height, data } = decodeRgba(buf);
  if (x < 0 || y < 0 || x >= width || y >= height) {
    throw new Error(`pixel (${x},${y}) out of bounds for ${width}x${height}`);
  }
  return data[y * width * 4 + x * 4 + 3];
}
