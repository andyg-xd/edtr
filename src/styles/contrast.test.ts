// src/styles/contrast.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');

function block(name: 'light' | 'dark'): Record<string, string> {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const d = stripped.indexOf("[data-theme='dark']");
  const m = stripped.indexOf('@media');
  const src = name === 'light' ? stripped.slice(0, d) : stripped.slice(d, m);
  const out: Record<string, string> = {};
  for (const mm of src.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[mm[1]] = mm[2].trim();
  return out;
}
const lum = (hex: string) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe.each(['light', 'dark'] as const)('contrast — %s theme', (theme) => {
  const t = block(theme);
  // The accent is per-theme precisely because one shared gold cannot pass on
  // both a near-white and a near-black surface.
  it('accent text on its own background meets AA (4.5:1)', () => {
    expect(ratio(t['--accent'], t['--accent-fg'])).toBeGreaterThanOrEqual(4.5);
  });
  it('body text on background meets AA (4.5:1)', () => {
    expect(ratio(t['--fg'], t['--bg'])).toBeGreaterThanOrEqual(4.5);
  });
  it('muted text on surface meets AA (4.5:1)', () => {
    expect(ratio(t['--fg-muted'], t['--surface'])).toBeGreaterThanOrEqual(4.5);
  });
  // The hovered-link hint in the status bar is small text in the accent.
  it('accent text on surface meets AA (4.5:1)', () => {
    expect(ratio(t['--accent'], t['--surface'])).toBeGreaterThanOrEqual(4.5);
  });
  it('faint text on surface meets large-text AA (3:1)', () => {
    expect(ratio(t['--fg-faint'], t['--surface'])).toBeGreaterThanOrEqual(3);
  });
});

describe.each(['light', 'dark'] as const)('interaction states — %s theme', (theme) => {
  const t = block(theme);
  it('hover is perceptibly different from rest', () => {
    // Hover feedback the eye cannot detect is the same as no hover feedback.
    // Light mode nearly shipped at 0.96% because accent and accent-hover were
    // both pulled dark by the same white-text contrast constraint.
    const delta = Math.abs(lum(t['--accent']) - lum(t['--accent-hover'])) * 100;
    expect(delta, `accent ${t['--accent']} vs hover ${t['--accent-hover']}`).toBeGreaterThan(3);
  });
  it('hover still meets AA against accent-fg', () => {
    expect(ratio(t['--accent-hover'], t['--accent-fg'])).toBeGreaterThanOrEqual(4.5);
  });
});
