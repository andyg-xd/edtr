// src/styles/tokens.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const STYLES = resolve(__dirname);
const read = (f: string) => readFileSync(resolve(STYLES, f), 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const sheets = () => readdirSync(STYLES).filter((f) => f.endsWith('.css'));

describe('token contract', () => {
  it('has more than one stylesheet — the monolith is split', () => {
    expect(sheets().length).toBeGreaterThan(1);
  });

  it('declares no colour literal outside tokens.css', () => {
    // The whole point of the token system: one file owns colour. A literal
    // anywhere else means a surface has drifted off the system.
    const offenders: string[] = [];
    for (const f of sheets()) {
      if (f === 'tokens.css') continue;
      stripComments(read(f))
        .split('\n')
        .forEach((line, i) => {
          if (/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(line)) {
            offenders.push(`${f}:${i + 1} ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('defines the spacing, radius, and motion scales', () => {
    const t = read('tokens.css');
    for (const token of [
      '--space-1', '--space-2', '--space-3', '--space-4',
      '--space-5', '--space-6', '--space-7',
      '--radius-sm', '--radius-md', '--radius-lg',
      '--motion-fast', '--motion-panel', '--ease',
    ]) {
      expect(t, `missing ${token}`).toContain(`${token}:`);
    }
  });

  it('defines the accent triplet in BOTH themes', () => {
    // 6d-ii gives light and dark different accents because the dark gold
    // fails contrast on near-white. Both blocks must carry all three.
    const t = stripComments(read('tokens.css'));
    const light = t.slice(t.indexOf(':root'), t.indexOf("[data-theme='dark']"));
    const dark = t.slice(t.indexOf("[data-theme='dark']"));
    for (const token of ['--accent:', '--accent-hover:', '--accent-fg:']) {
      expect(light, `light missing ${token}`).toContain(token);
      expect(dark, `dark missing ${token}`).toContain(token);
    }
  });
});

describe('reduced motion', () => {
  it('collapses every motion token to 0ms in one media block', () => {
    const t = stripComments(read('tokens.css'));
    const m = t.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\}\s*\}/);
    expect(m, 'no prefers-reduced-motion block in tokens.css').toBeTruthy();
    expect(m![0]).toContain('--motion-fast: 0ms');
    expect(m![0]).toContain('--motion-panel: 0ms');
  });

  it('no stylesheet special-cases reduced motion on its own', () => {
    // Motion is disabled centrally by zeroing the tokens. A component-level
    // media query means a future component could miss it.
    for (const f of sheets()) {
      if (f === 'tokens.css') continue;
      expect(read(f), `${f} handles reduced motion itself`).not.toContain('prefers-reduced-motion');
    }
  });

  it('every transition uses a motion token, never a literal duration', () => {
    const offenders: string[] = [];
    for (const f of sheets()) {
      stripComments(read(f))
        .split('\n')
        .forEach((line, i) => {
          if (/transition:/.test(line) && !/var\(--motion-/.test(line)) {
            offenders.push(`${f}:${i + 1} ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
