// jsdom has no layout, so a dialog stretching to the window cannot be observed
// here. What can be pinned is the rule that prevents it: every dialog shares
// `.modal`, and `.modal` is capped by one token.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tokens = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
const banners = readFileSync(resolve(__dirname, 'banners.css'), 'utf8');

describe('dialog width', () => {
  it('defines one width for every dialog', () => {
    expect(tokens).toMatch(/--dialog-width:\s*\d+px;/);
  });

  it('caps the shared dialog box at that width, and inside the window', () => {
    const rule = /\.modal\s*\{([^}]*)\}/.exec(banners)?.[1] ?? '';
    expect(rule).toMatch(/max-width:\s*min\(var\(--dialog-width\),\s*calc\(100vw - [^;]+\)\);/);
  });
});
