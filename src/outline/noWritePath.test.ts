import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Imports that would mean this feature can write to a document.
 *
 * Spec D3: the outline navigates and never edits, so the no-beautify
 * guarantee here is STRUCTURAL — there is no write path to get wrong,
 * which is a stronger and cheaper claim than a round-trip test.
 */
const FORBIDDEN = [
  'serialize', 'writeBack', 'spliceSource', 'splice',
  '@tauri-apps', 'markdownSerializer', 'htmlWriteBack',
];

describe('the outline has no write path (spec D3)', () => {
  const sources = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.'));

  it('has source files to check — a vacuous pass is not a pass', () => {
    expect(sources.length).toBeGreaterThan(4);
  });

  it.each(sources)('%s imports nothing that can write', (file) => {
    const text = readFileSync(join(DIR, file), 'utf8');
    const imports = [...text.matchAll(/^\s*import[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
    const offending = imports.filter((spec) => FORBIDDEN.some((f) => spec.includes(f)));
    expect(offending, `${file} may not import a write path`).toEqual([]);
  });
});
