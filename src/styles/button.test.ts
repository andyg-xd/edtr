import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(__dirname, '..');
function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p);
    return e.name.endsWith('.tsx') && !e.name.includes('.test.') ? [p] : [];
  });
}

describe('button primitive', () => {
  it('no bare <button> is rendered anywhere', () => {
    // This is the regression that produced the primitive: dialogs shipped
    // unstyled browser buttons because nothing forced otherwise.
    const offenders: string[] = [];
    for (const f of tsxFiles(SRC)) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const m = /<button(\s[^>]*)?>/.exec(line);
        if (m && !/className=/.test(m[0])) {
          offenders.push(`${f.replace(SRC, 'src')}:${i + 1} ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('defines all three variants', () => {
    const css = readFileSync(resolve(__dirname, 'button.css'), 'utf8');
    for (const v of ['.btn--primary', '.btn--secondary', '.btn--danger']) {
      expect(css, `missing ${v}`).toContain(v);
    }
  });

  it('has a visible focus ring', () => {
    // Keyboard users need to see where they are; a primitive without one
    // spreads that gap to every dialog at once.
    expect(readFileSync(resolve(__dirname, 'button.css'), 'utf8')).toContain(':focus-visible');
  });
});
