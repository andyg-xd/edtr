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

  it('covers both weights and both styles with real faces (range or discrete)', () => {
    // A variable font declares a weight RANGE; static cuts declare discrete
    // values. Either is fine. What must never happen is a weight/style the
    // browser has to synthesise, which looks materially worse than the system
    // font this replaces.
    const faces = read('fonts.css').split('@font-face').slice(1);
    const covers = (weight: number, style: string) =>
      faces.some((f) => {
        const st = /font-style:\s*(\w+)/.exec(f)?.[1];
        if (st !== style) return false;
        const nums = [...f.matchAll(/font-weight:\s*([\d\s]+);/g)]
          .flatMap((m) => m[1].trim().split(/\s+/).map(Number));
        if (nums.length === 0) return false;
        if (nums.length === 1) return nums[0] === weight;
        return weight >= Math.min(...nums) && weight <= Math.max(...nums);
      });
    for (const [w, s] of [[400, 'normal'], [400, 'italic'], [600, 'normal'], [600, 'italic']] as const) {
      expect(covers(w, s), `no face covers weight ${w} ${s}`).toBe(true);
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
