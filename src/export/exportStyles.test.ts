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

/** The declarations of the first `<selector> { … }` in `css`, whitespace collapsed. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return '';
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open)).replace(/\s+/g, ' ').trim();
}

function capture(text: string, pattern: RegExp): string {
  const m = pattern.exec(text);
  if (!m) throw new Error(`${pattern} not found in: ${text}`);
  return m[1];
}

describe('EXPORT_STYLES — a diagram too wide for the page', () => {
  const print = printBlock(EXPORT_STYLES);
  const screen = EXPORT_STYLES.replace(print, '');
  const diagramCode = rule(print, 'pre.md-code.md-diagram code');

  it('shrinks a printed diagram to fit its column count, never above the normal code size', () => {
    expect(rule(print, 'pre.md-code.md-diagram')).toBe('container-type: inline-size;');
    expect(diagramCode).toContain('font-size: min(0.88em, 100cqi / (var(--diagram-cols, 1) * 0.64));');
  });

  it('shrinks the rows with the text, so a diagram keeps its proportions', () => {
    // An inline <code> sits on the pre's full-size line however small its text.
    expect(diagramCode).toContain('display: block;');
    expect(diagramCode).toContain('line-height: calc(1.6em / 0.88);');
  });

  it('derives the cap and the row height from the sizes every other block uses', () => {
    const normalCode = capture(rule(screen, 'pre code'), /font-size: ([\d.]+em);/);
    const bodyLine = capture(rule(screen, 'body'), /font: \d+px\/([\d.]+) /);
    expect(capture(diagramCode, /font-size: min\(([\d.]+em),/)).toBe(normalCode);
    const [, lineNumerator, lineDivisor] = /line-height: calc\(([\d.]+)em \/ ([\d.]+)\);/.exec(diagramCode) ?? [];
    expect(lineNumerator).toBe(bodyLine);
    expect(`${lineDivisor}em`).toBe(normalCode);
  });

  it('leaves the screen copy scrolling sideways, unshrunk', () => {
    expect(screen).toContain('pre.md-code.md-diagram { white-space: pre; overflow-x: auto; }');
    expect(screen).not.toContain('--diagram-cols');
    expect(screen).not.toContain('container-type');
    expect(screen).not.toContain('display: block');
  });
});
