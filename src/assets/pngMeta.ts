import { inflateSync } from 'node:zlib';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface PngMeta {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
}

// Must cover every byte readPngMeta/decodeRgba read out of the IHDR chunk:
// 8 (signature) + 4 (chunk length) + 4 ("IHDR") + 13 (IHDR data, through the
// interlace method at byte 28) + 4 (CRC) = 33. A signature-valid buffer
// shorter than this would otherwise read past its own bytes into whatever
// came next and return undefined/garbage fields instead of throwing.
const MIN_IHDR_LENGTH = 33;

function assertSignature(buf: Uint8Array): void {
  if (buf.length < MIN_IHDR_LENGTH) throw new Error('not a png: too short');
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new Error('not a png: bad signature');
  }
}

function isPngSignature(buf: Uint8Array): boolean {
  if (buf.length < SIGNATURE.length) return false;
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (buf[i] !== SIGNATURE[i]) return false;
  }
  return true;
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
  // IHDR byte 28 (0-indexed from the start of the file): the interlace method.
  // The scanline-filter loop below only implements the non-interlaced layout
  // (Adam7 interleaves 7 sub-images with different strides/dimensions).
  const interlaceMethod = buf[28];
  if (interlaceMethod !== 0) {
    throw new Error(
      `expected non-interlaced PNG (interlace method 0), got interlace method ${interlaceMethod}`
    );
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

const ICNS_MAGIC = [0x69, 0x63, 0x6e, 0x73]; // 'icns'
const ICNS_HEADER_LENGTH = 8; // magic (4) + total file length (4)
const ICNS_RECORD_HEADER_LENGTH = 8; // type code (4) + record total length (4)

export interface IcnsPng {
  type: string;
  data: Uint8Array;
}

/**
 * Extract every embedded PNG payload from an .icns icon bundle.
 *
 * Layout: an 8-byte file header (magic 'icns' followed by a big-endian
 * uint32 total file length), then a flat sequence of records. Each record is
 * a 4-byte type code, a big-endian uint32 giving the record's TOTAL length
 * (including these 8 header bytes), then the payload.
 *
 * Not every record holds a PNG — legacy raw/RLE formats and masks (e.g.
 * 'il32', 'l8mk', 'is32', 's8mk') predate PNG support in .icns, and 'TOC '
 * is a table of contents, not image data. Members are therefore identified
 * by sniffing the PNG signature on the payload itself rather than by
 * hardcoding a list of "these type codes are PNG" — Apple has added new
 * PNG-backed type codes over time (ic07..ic14 and beyond) and a hardcoded
 * list would silently miss whichever one macOS actually renders next.
 */
export function extractIcnsPngs(buf: Uint8Array): IcnsPng[] {
  if (buf.length < ICNS_HEADER_LENGTH) throw new Error('not an icns: too short');
  for (let i = 0; i < ICNS_MAGIC.length; i++) {
    if (buf[i] !== ICNS_MAGIC[i]) throw new Error('not an icns: bad magic');
  }
  const fileLength = readU32(buf, 4);
  if (fileLength !== buf.length) {
    throw new Error(`icns file length mismatch: header says ${fileLength}, buffer is ${buf.length} bytes`);
  }

  const images: IcnsPng[] = [];
  let off = ICNS_HEADER_LENGTH;
  while (off < buf.length) {
    if (off + ICNS_RECORD_HEADER_LENGTH > buf.length) {
      throw new Error(`icns record header runs past end of buffer at offset ${off}`);
    }
    const type = String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
    const recordLength = readU32(buf, off + 4);
    if (recordLength < ICNS_RECORD_HEADER_LENGTH || off + recordLength > buf.length) {
      throw new Error(`icns malformed record length ${recordLength} for type '${type}' at offset ${off}`);
    }
    if (type !== 'TOC ') {
      const payload = buf.subarray(off + ICNS_RECORD_HEADER_LENGTH, off + recordLength);
      if (isPngSignature(payload)) images.push({ type, data: payload });
    }
    off += recordLength;
  }
  return images;
}
