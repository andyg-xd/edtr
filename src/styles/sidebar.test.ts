import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Comments stripped first: they sit between rules, so a naive selector capture
// swallows them and the selector never matches. Same helper shape as
// tableFocus.test.ts, including its grouped-selector handling.
const css = readFileSync(resolve(__dirname, 'sidebar.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function declarationsFor(selector: string): string | null {
  const out: string[] = [];
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const list = selectors.split(',').map((x) => x.trim());
    if (list.includes(selector)) out.push(body);
  }
  return out.length ? out.join('\n') : null;
}

/**
 * The regression this locks, MEASURED in a browser on 2026-08-26 rather than
 * reasoned about (the last two layout diagnoses in this project each named the
 * wrong cause twice before an A/B settled it).
 *
 * `.editor-body` is a flex ROW. Before 6c-iv, `<nav class="sidebar">` was a
 * direct child of it, so `flex: 0 0 200px` meant 200px WIDE. 6c-iv inserted
 * `.sidebar-shell` between them — a flex COLUMN — and two things broke at once
 * from that single change:
 *
 *   - the shell carried no width, so it fell back to `flex: 0 1 auto` and
 *     sized to its longest row: measured at 449px against an intended 200px,
 *     taking half the window and cutting the document pane from 699px to 451px;
 *   - `.sidebar`'s `flex: 0 0 200px` now resolved on the COLUMN's main axis,
 *     so it meant 200px TALL. Measured 200px of a 600px frame — exactly the
 *     "only about a third of the sidebar" in the owner's report.
 *
 * The fix measured clean at 200x600 with the pane back to 700px: the row-axis
 * width belongs on the shell, and the pane fills the column and scrolls.
 */
describe('sidebar layout — the shell owns the width, the pane fills the column', () => {
  it('gives .sidebar-shell the fixed row-axis width', () => {
    const decls = declarationsFor('.sidebar-shell');
    expect(decls).not.toBeNull();
    expect(decls).toMatch(/flex:\s*0\s+0\s+200px/);
  });

  it('lets .sidebar-shell shrink in the column so its pane can scroll', () => {
    expect(declarationsFor('.sidebar-shell')).toMatch(/min-height:\s*0/);
  });

  it('makes the pane inside the shell fill the column instead of sizing to 200px', () => {
    // Without this the pane keeps a 200px flex-basis that the column reads as
    // a HEIGHT. This is the rule that unclips the list.
    //
    // The basis is ZERO, not `auto`, and that is the second half of the fix.
    // With `auto` the pane's CONTENT height enters flex sizing, so a long
    // outline overflowed the column and the shortfall was distributed across
    // every item in it — including the Files/Outline switch, which visibly
    // squashed. Measured across window heights: the switch fell from its
    // natural 20px to 15.7px at 420px tall, 13.6px at 360px and 9.6px at
    // 240px, degrading continuously as the window shortened. A basis of 0
    // means the pane takes exactly the space left over and its content never
    // pushes back.
    const decls = declarationsFor('.sidebar-shell > .sidebar');
    expect(decls).not.toBeNull();
    expect(decls).toMatch(/flex:\s*1\s+1\s+0/);
    expect(decls).toMatch(/min-height:\s*0/);
  });

  it('stops the Files/Outline switch from being squashed by the pane', () => {
    // Independently correct regardless of the pane's basis: a segmented
    // control is fixed chrome and must never absorb a sibling's overflow.
    // Belt and braces on purpose — either rule alone measured clean, and they
    // state two different things.
    expect(declarationsFor('.sidebar-switch')).toMatch(/flex:\s*none/);
  });

  it('keeps the pane scrollable, which is what makes a clipped list reachable', () => {
    expect(declarationsFor('.sidebar')).toMatch(/overflow-y:\s*auto/);
  });
});
