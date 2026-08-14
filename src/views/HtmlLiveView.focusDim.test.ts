import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOCUS_DIM_CSS } from './HtmlLiveView';

/**
 * Focus mode's dim in HTML Live (6c-ii-b, F3).
 *
 * These assert the SHAPE of the stylesheet rather than a rendered colour,
 * because the defect lives in a place jsdom cannot reach: it has no cascade,
 * does not implement `color-mix`, and never composites text against a
 * background. The bug was found by hand in the running app and root-caused by
 * reading the file's palette out of the fixture — not by any test, and no test
 * in this suite could have found it.
 *
 * What CAN be asserted mechanically is that the rule does not go back to the
 * two shapes known to be wrong, which is what these are for. The colour itself
 * is a GUI gate.
 */
describe('HTML Live focus dim', () => {
  it('does NOT dim to an absolute foreground token', () => {
    // The defect, exactly. `--dim-fg` is calibrated against EDTR's canvas;
    // HTML Live renders the FILE's canvas, so in dark theme the token is a
    // dark grey that reads as body text on white ("does nothing"), and in
    // light theme it darkens every colour lighter than itself. Any absolute
    // foreground here reintroduces that.
    // Asserted as a flat "this token appears nowhere in this stylesheet",
    // NOT as a pattern anchored to `.edtr-dim{`. The first version of this
    // test was anchored that way and passed against the real pre-fix CSS,
    // because that rule was written `.edtr-dim,.edtr-dim *{…}` — a selector
    // LIST, so the anchored pattern never matched and the negative assertion
    // held vacuously. It was caught by running this file against the old
    // stylesheet rather than by reading it.
    expect(FOCUS_DIM_CSS).not.toContain('var(--dim-fg)');
    expect(FOCUS_DIM_CSS).not.toContain('--fg-disabled');
  });

  it('fades relative to the colour the file already had', () => {
    // `currentColor` in the `color` property is the INHERITED colour, so this
    // fades what the element would have been rather than replacing it.
    expect(FOCUS_DIM_CSS).toMatch(/color-mix\([^)]*currentColor/);
    expect(FOCUS_DIM_CSS).toContain('var(--dim-fade)');
  });

  it('applies the fade EXACTLY ONCE, so nesting cannot compound it', () => {
    // The trap in this fix. If the descendant rule repeated the color-mix,
    // `currentColor` would re-mix against the parent's already-faded value at
    // every level: a span inside a link inside a paragraph lands at
    // 0.32^3 ~= 3% and disappears. `inherit` copies the parent's computed
    // value, so the fade applies once at whatever depth.
    const descendantRule = FOCUS_DIM_CSS.match(/\.edtr-dim \*\{([^}]*)\}/);
    expect(descendantRule, 'the .edtr-dim * rule must exist').not.toBeNull();
    expect(descendantRule![1]).toContain('inherit');
    expect(descendantRule![1]).not.toContain('color-mix');
  });

  it('does NOT use opacity on the block', () => {
    // The rejected alternative, asserted so it cannot be "simplified" back in.
    // Opacity is simpler and preserves hues perfectly, but an ancestor's
    // opacity cannot be undone by a descendant — the find restore below would
    // stop working, taking with it a capability 6c-i shipped and matrix items
    // 9 and 19 exist to protect.
    expect(FOCUS_DIM_CSS).not.toMatch(/\.edtr-dim\s*\{[^}]*opacity/);
  });

  it('still restores find matches, at a specificity that beats the dim', () => {
    expect(FOCUS_DIM_CSS).toContain('.edtr-dim edtr-mark.edtr-find');
    // Self-contained pair: the file supplies the background, so an Edtr shell
    // token could land as light-on-white or dark-on-black.
    expect(FOCUS_DIM_CSS).toContain('var(--find-current-bg)');
    expect(FOCUS_DIM_CSS).toContain('var(--find-current-fg)');
  });

  it('the token it depends on actually exists', () => {
    // A CSS custom property that is never defined makes the whole declaration
    // invalid at computed-value time, which would silently leave the block
    // undimmed — the same "looks like nothing happened" symptom being fixed
    // here. Nothing else in the build would catch a typo in the name.
    const tokens = readFileSync(join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8');
    expect(tokens).toMatch(/--dim-fade:\s*\d+%/);
  });

  it('leaves the surfaces Edtr DOES own on the absolute token', () => {
    // Deliberate asymmetry, asserted so it reads as a decision rather than an
    // oversight: Code view and Markdown Live render on Edtr's own canvas with
    // Edtr's own palette, where an absolute colour is correct and is what the
    // reduced-contrast escape hatch acts on. Only HTML Live has a palette we
    // do not control.
    const canvas = readFileSync(join(process.cwd(), 'src', 'styles', 'canvas.css'), 'utf8');
    expect(canvas).toContain('var(--dim-fg)');
  });
});
