import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Comments stripped first: they sit between rules, so a naive selector
// capture swallows them and the selector never matches.
const css = readFileSync(resolve(__dirname, 'canvas.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every declaration that applies to `selector`, across all rules.
 *
 * Deliberately NOT the naive `<selector>\s*{` match the other style tests use:
 * that cannot see a GROUPED selector, so `.live-view td:has(…)` in a
 * comma-separated list reads as absent while `.live-view th:has(…)` silently
 * matches the wrong rule. Improving the helper beats reshaping production CSS
 * to suit a weak matcher.
 */
function declarationsFor(selector: string): string | null {
  const out: string[] = [];
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const list = selectors.split(',').map((x) => x.trim());
    if (list.includes(selector)) out.push(body);
  }
  return out.length ? out.join('\n') : null;
}

/**
 * The defect this locks (6c-iv Task 12, measured not guessed): focus mode dims
 * only `color`, and only on the cell's paragraph. A table's grid is painted by
 * explicit colours on the cell itself, so the text faded while the grid stayed
 * at full strength — and against faded surroundings the grid read as "the
 * whole table is highlighted", which is how this was reported.
 *
 * The decoration layer was correct throughout and is deliberately untouched.
 */
describe('focus mode fades a table’s chrome, not just its text', () => {
  it('fades the border of a cell whose content is dimmed', () => {
    const rule = declarationsFor('.live-view td:has(> .edtr-dim)');
    expect(rule, 'no focus-mode rule for a dimmed cell').not.toBeNull();
    expect(rule).toContain('border-color');
    // Relative to the SAME fade the text uses, so the grid and the words it
    // contains recede together rather than at two different rates.
    expect(rule).toContain('--dim-fade');
  });

  it('fades a header cell’s background too, which is the loudest part of the grid', () => {
    const rule = declarationsFor('.live-view th:has(> .edtr-dim)');
    expect(rule, 'no focus-mode rule for a dimmed header cell').not.toBeNull();
    expect(rule).toContain('background');
    expect(rule).toContain('--dim-fade');
  });

  it('leaves the ordinary table rules alone — this must not change how a table looks with focus mode OFF', () => {
    const base = declarationsFor('.live-view td');
    expect(base).not.toBeNull();
    expect(base).toContain('var(--table-border)');
    expect(base).not.toContain('--dim-fade');
  });
});
