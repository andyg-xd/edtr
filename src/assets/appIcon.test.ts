import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readPngMeta, hasAlphaChannel, readPixelAlpha, extractIcnsPngs } from './pngMeta';

const ICONS_DIR = resolve(__dirname, '../../src-tauri/icons');
const TAURI_CONF = resolve(__dirname, '../../src-tauri/tauri.conf.json');

const icon = (name: string) => readFileSync(resolve(ICONS_DIR, name));

// Antialiased edge pixels around the artwork's rounded corners have low but
// non-zero alpha; scanning for strictly `> 0` counts that faint fringe and
// makes the measured span sensitive to the icon's resolution. Requiring
// alpha above this threshold before a pixel counts as "artwork" gives a
// stable measurement across every generated size.
const ARTWORK_ALPHA_THRESHOLD = 127;

// ICO is a different container format from PNG/ICNS, and Windows is not a
// shipping target for Edtr (macOS-only, per the project's locked
// architecture). It is intentionally excluded from this suite's coverage —
// not silently skipped, but named here so a reviewer can see the omission
// was a decision, not an oversight.
const SKIPPED_BUNDLE_ICON_EXTENSIONS = ['.ico'];

/**
 * The bundle.icon list from tauri.conf.json IS the spec for "what macOS
 * actually loads." Driving assertions off this array (rather than a fixed
 * set of hardcoded filenames) means a future change to the bundled icon set
 * is covered automatically, and — combined with the non-empty assertion
 * below — can't silently shrink this suite's coverage to nothing.
 */
function readBundleIconPaths(): string[] {
  const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf-8'));
  const bundleIcon: unknown = conf?.bundle?.icon;
  if (!Array.isArray(bundleIcon) || bundleIcon.length === 0) {
    throw new Error(
      'tauri.conf.json bundle.icon is missing or empty — the app would ship with no icon, ' +
        'and this test would silently cover nothing. Fix the config or this test, not just one.'
    );
  }
  return bundleIcon as string[];
}

const BUNDLE_ICON_PATHS = readBundleIconPaths();

const bundlePngPaths = BUNDLE_ICON_PATHS.filter(
  (p) => p.endsWith('.png') && !SKIPPED_BUNDLE_ICON_EXTENSIONS.some((ext) => p.endsWith(ext))
);
const bundleIcnsPaths = BUNDLE_ICON_PATHS.filter((p) => p.endsWith('.icns'));

describe('bundle.icon coverage', () => {
  it('every bundle.icon entry is accounted for by this suite (png, icns, or an explicitly skipped ext)', () => {
    for (const p of BUNDLE_ICON_PATHS) {
      const covered =
        bundlePngPaths.includes(p) ||
        bundleIcnsPaths.includes(p) ||
        SKIPPED_BUNDLE_ICON_EXTENSIONS.some((ext) => p.endsWith(ext));
      expect(covered, `bundle.icon entry '${p}' is neither .png, .icns, nor a named skip`).toBe(true);
    }
  });

  it('has at least one .png and one .icns entry to check', () => {
    expect(bundlePngPaths.length).toBeGreaterThan(0);
    expect(bundleIcnsPaths.length).toBeGreaterThan(0);
  });
});

describe('shipped macOS app icon — every bundle.icon PNG', () => {
  for (const relPath of bundlePngPaths) {
    describe(relPath, () => {
      const name = relPath.replace(/^icons\//, '');

      it('is RGBA (colour type 6) with an alpha channel', () => {
        const buf = icon(name);
        expect(readPngMeta(buf).colorType).toBe(6);
        expect(hasAlphaChannel(buf)).toBe(true);
      });

      it('has fully transparent corners at all four corners', () => {
        const buf = icon(name);
        const { width: w, height: h } = readPngMeta(buf);
        for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]] as const) {
          expect(readPixelAlpha(buf, x, y)).toBe(0);
        }
      });

      it('is opaque at the centre', () => {
        const buf = icon(name);
        const { width: w, height: h } = readPngMeta(buf);
        expect(readPixelAlpha(buf, Math.floor(w / 2), Math.floor(h / 2))).toBe(255);
      });
    });
  }

  it('sizes the artwork to Apple’s macOS grid (80.5% ±1%) on the largest bundled PNG', () => {
    // The antialiasing-driven span measurement is resolution-sensitive (see
    // ARTWORK_ALPHA_THRESHOLD above) and only reliable at larger sizes, so
    // this check runs once against the biggest bundled PNG rather than
    // against every size.
    const largest = bundlePngPaths.reduce((best, p) => {
      const bestMeta = readPngMeta(icon(best.replace(/^icons\//, '')));
      const meta = readPngMeta(icon(p.replace(/^icons\//, '')));
      return meta.width > bestMeta.width ? p : best;
    });
    const buf = icon(largest.replace(/^icons\//, ''));
    const { width: w, height: h } = readPngMeta(buf);
    const mid = Math.floor(h / 2);
    let left = 0;
    while (left < w && readPixelAlpha(buf, left, mid) <= ARTWORK_ALPHA_THRESHOLD) left++;
    let right = w - 1;
    while (right > left && readPixelAlpha(buf, right, mid) <= ARTWORK_ALPHA_THRESHOLD) right--;
    const pct = (100 * (right - left + 1)) / w;
    expect(pct).toBeGreaterThan(79.5);
    expect(pct).toBeLessThan(81.5);
  });

  // icon.png is a real generated artifact (the tauri-icon source render) and
  // isn't itself in bundle.icon, but it's cheap insurance to keep it locked
  // too since the other bundled sizes are generated from it.
  it('icon.png (the generator source, not itself bundled) is RGBA with transparent corners', () => {
    const buf = icon('icon.png');
    expect(readPngMeta(buf).colorType).toBe(6);
    expect(hasAlphaChannel(buf)).toBe(true);
    const { width: w, height: h } = readPngMeta(buf);
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]] as const) {
      expect(readPixelAlpha(buf, x, y)).toBe(0);
    }
  });
});

describe('shipped macOS app icon — icon.icns (the artifact macOS actually renders in the Dock)', () => {
  for (const relPath of bundleIcnsPaths) {
    describe(relPath, () => {
      const name = relPath.replace(/^icons\//, '');

      it('extracts at least one embedded PNG', () => {
        const images = extractIcnsPngs(icon(name));
        expect(images.length).toBeGreaterThan(0);
      });

      it('every embedded PNG member has an alpha channel and a transparent (0,0) corner', () => {
        const images = extractIcnsPngs(icon(name));
        expect(images.length).toBeGreaterThan(0);
        for (const { type, data } of images) {
          expect(hasAlphaChannel(data), `icns member '${type}' has no alpha channel`).toBe(true);
          expect(readPixelAlpha(data, 0, 0), `icns member '${type}' corner (0,0) is not transparent`).toBe(
            0
          );
        }
      });
    });
  }
});
