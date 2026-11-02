import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IMAGE_EXTS } from './imageTypes';

// The Rust copy command refuses anything not on its own list, so a type added
// here alone would be offered by the picker and drag-drop, then refused.
describe('picture types', () => {
  it('Rust and the frontend agree on which files are pictures', () => {
    const rust = readFileSync(resolve(__dirname, '../../src-tauri/src/assets.rs'), 'utf8');
    const list = /pub const IMAGE_EXTS: &\[&str\] = &\[([^\]]*)\];/.exec(rust)?.[1];
    expect(list, 'IMAGE_EXTS not found in assets.rs').toBeDefined();
    const rustExts = [...list!.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(rustExts).toEqual([...IMAGE_EXTS]);
  });
});
