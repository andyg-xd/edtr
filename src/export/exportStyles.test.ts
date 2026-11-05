import { describe, it, expect } from 'vitest';
import { EXPORT_STYLES } from './exportStyles';

/** The body of the first `@media print { … }` block, braces matched. */
function printBlock(css: string): string {
  const start = css.indexOf('@media print {');
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return '';
}

describe('EXPORT_STYLES — a diagram too wide for the page', () => {
  const print = printBlock(EXPORT_STYLES);
  const screen = EXPORT_STYLES.replace(print, '');

  it('shrinks a printed diagram to fit its column count, never above the normal code size', () => {
    expect(print).toContain('pre.md-code.md-diagram { container-type: inline-size; }');
    expect(print).toContain(
      'pre.md-code.md-diagram code { font-size: min(0.88em, 100cqi / (var(--diagram-cols, 1) * 0.64)); }',
    );
  });

  it('keeps the normal code size the shrink rule is capped at', () => {
    expect(EXPORT_STYLES).toContain('pre code { font-size: 0.88em; }');
  });

  it('leaves the screen copy scrolling sideways, unshrunk', () => {
    expect(screen).toContain('pre.md-code.md-diagram { white-space: pre; overflow-x: auto; }');
    expect(screen).not.toContain('--diagram-cols');
    expect(screen).not.toContain('container-type');
  });
});
