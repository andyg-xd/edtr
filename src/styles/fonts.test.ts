// src/styles/fonts.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const STYLES = resolve(__dirname);
const read = (f: string) => readFileSync(resolve(STYLES, f), 'utf8');

describe('bundled font', () => {
  it('ships woff2 files', () => {
    const files = readdirSync(resolve(STYLES, 'fonts'));
    expect(files.filter((f) => f.endsWith('.woff2')).length).toBeGreaterThan(0);
  });

  it('ships the OFL licence alongside them', () => {
    // Redistribution is only permitted with the licence attached.
    expect(existsSync(resolve(STYLES, 'fonts/LICENSE.md'))).toBe(true);
  });

  it('declares real cuts for both weights AND both styles', () => {
    // Missing a cut means the browser synthesises it, which looks materially
    // worse than the system font this replaces.
    const css = read('fonts.css');
    const faces = css.split('@font-face').slice(1);
    const have = faces.map((f) => [
      /font-weight:\s*(\d+)/.exec(f)?.[1],
      /font-style:\s*(\w+)/.exec(f)?.[1],
    ].join('/'));
    for (const want of ['400/normal', '400/italic', '600/normal', '600/italic']) {
      expect(have, `no @font-face for ${want}`).toContain(want);
    }
  });

  it('every src points at a file that exists', () => {
    const css = read('fonts.css');
    for (const m of css.matchAll(/url\('\.\/fonts\/([^']+)'\)/g)) {
      expect(existsSync(resolve(STYLES, 'fonts', m[1])), `missing ${m[1]}`).toBe(true);
    }
  });

  it('defines the full type scale', () => {
    const t = read('tokens.css');
    for (const k of ['--text-xs', '--text-sm', '--text-base', '--text-canvas', '--text-lg', '--text-xl', '--font-sans']) {
      expect(t, `missing ${k}`).toContain(`${k}:`);
    }
  });

  it('no stylesheet hardcodes a px font-size', () => {
    const offenders: string[] = [];
    for (const f of readdirSync(STYLES).filter((x) => x.endsWith('.css'))) {
      read(f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').forEach((line, i) => {
        if (/font-size:\s*\d+px/.test(line)) offenders.push(`${f}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
