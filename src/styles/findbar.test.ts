import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, 'findbar.css'), 'utf8');

/** Every rule's selector list, one array per rule. */
function selectorLists(source: string): string[][] {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return Array.from(noComments.matchAll(/([^{}]+)\{[^}]*\}/g), (m) =>
    m[1].split(',').map((s) => s.trim()).filter(Boolean));
}

describe('find bar stylesheet', () => {
  it('styles the replace field with every rule the find field gets', () => {
    // The replace field shipped as a UA-default grey box with square corners:
    // every field rule named `.find-input` alone, and the replace row's input
    // carries its own class. Each `.find-input` selector must have its
    // `.find-replace-input` twin in the same rule, so the two cannot drift.
    const missing: string[] = [];
    for (const list of selectorLists(css)) {
      for (const sel of list.filter((s) => s.includes('.find-input'))) {
        const twin = sel.replace('.find-input', '.find-replace-input');
        if (!list.includes(twin)) missing.push(twin);
      }
    }
    expect(missing).toEqual([]);
  });

  it('shows the replace field as disabled when there is nothing to replace', () => {
    const lists = selectorLists(css).flat();
    expect(lists).toContain('.find-replace-input:disabled');
  });
});
