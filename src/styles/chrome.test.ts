import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, 'chrome.css'), 'utf8');

function ruleFor(selector: string): string | null {
  const m = css.match(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`),
  );
  return m ? m[1] : null;
}

describe('document pane', () => {
  it('can shrink below its content on BOTH axes', () => {
    // Measured defect (2026-08-20): `.doc-pane` is a flex item of the row
    // `.editor-body`, so `min-width` defaults to `auto` and the pane refuses
    // to shrink under its content's intrinsic width. A single unwrapped
    // 20,000-character line in Code view stretched it to ~156,000px against a
    // 1,000px viewport, scrolling the window sideways and taking the
    // toolbar's right-aligned controls with it.
    //
    // `min-height: 0` was already here for the column axis. The row axis was
    // simply never given the same treatment, and nothing failed when it
    // wasn't -- which is why this assertion exists rather than a comment.
    const pane = ruleFor('.doc-pane');
    expect(pane, 'no .doc-pane rule').not.toBeNull();
    expect(pane, 'the column axis lost its escape hatch').toMatch(/min-height:\s*0/);
    expect(pane, 'the row axis can pin the pane open again').toMatch(/min-width:\s*0/);
  });
});
