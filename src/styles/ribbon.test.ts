import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, 'ribbon.css'), 'utf8');

/** The declaration body of a rule, or null if the selector isn't styled. */
function ruleFor(selector: string): string | null {
  const m = css.match(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`),
  );
  return m ? m[1] : null;
}

describe('persistent toolbar row', () => {
  it('draws the rule beneath the ROW, so it reaches the actions zone', () => {
    // The GUI defect this locks (6c-iii, 2026-08-20): the rule under the
    // toolbar stopped before the last three buttons and read as broken. It
    // was `.ribbon`'s own `border-bottom`, and `.ribbon` fills only the
    // FORMATTING zone — so it could never span the actions zone beside it.
    const row = ruleFor('.doc-toolbar');
    expect(row, 'no .doc-toolbar rule').not.toBeNull();
    expect(row).toMatch(/border-bottom:\s*1px solid var\(--border\)/);
  });

  it('stops the ribbon drawing that rule a second time inside the row', () => {
    // The other half of the same fix, and the half that can silently regress:
    // put the border back on the zone and the short line returns, with the
    // row's own full-width rule still present to make it look intentional.
    const zoneRibbon = ruleFor('.doc-toolbar-formatting .ribbon');
    expect(zoneRibbon, 'the ribbon is not neutralised inside the toolbar').not.toBeNull();
    expect(zoneRibbon).toMatch(/border-bottom:\s*none/);
    expect(zoneRibbon).toMatch(/background:\s*transparent/);
  });

  it('insets the row itself, so BOTH ends clear the window edge', () => {
    // Replaces an earlier fix that put a right inset on the actions zone
    // alone. One owner, not two: symmetry then costs nothing and cannot
    // drift, which is exactly how the two ends came to disagree.
    const row = ruleFor('.doc-toolbar')!;
    expect(row).toMatch(/padding:\s*var\(--space-\d\)\s+var\(--space-\d\)/);

    const actions = ruleFor('.doc-toolbar-actions');
    expect(actions, 'no .doc-toolbar-actions rule').not.toBeNull();
    expect(actions, 'the actions zone is insetting itself again — the row owns this')
      .not.toMatch(/padding/);
  });

  it('leaves the contextual table ribbon its own chrome', () => {
    // `.ribbon-context` is a SIBLING of the toolbar row, not a descendant, so
    // it is not covered by the neutralising rule above and still needs the
    // separation `.ribbon` gives it. Moving chrome off `.ribbon` entirely
    // would have silently flattened the table toolbar.
    const ribbon = ruleFor('.ribbon');
    expect(ribbon, 'no .ribbon rule').not.toBeNull();
    expect(ribbon).toMatch(/border-bottom:\s*1px solid var\(--border\)/);
    expect(css).toContain('.ribbon-context');
  });
});
