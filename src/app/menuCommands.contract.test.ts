import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MENU_COMMANDS } from './menuCommands';

/**
 * The cross-language seam, asserted instead of trusted.
 *
 * Rust emits `menu://<name>` and the frontend subscribes to `menu://<name>` for
 * every name in `MENU_COMMANDS`. Those are two lists in two languages that no
 * compiler compares, and when they disagree the failure is **silent**: the menu
 * item is enabled, clicking it emits an event, and nothing anywhere is
 * listening. That is exactly how ⌥⌘F shipped in 6c-i-b doing literally nothing
 * while all 914 tests passed — the defect was invisible because no test
 * crossed the boundary.
 *
 * This reads the Rust source and compares the sets. It is the only test in the
 * suite that can fail for a mistake made in a `.rs` file, which is the point.
 *
 * `open-payload` is the one legitimate asymmetry: it carries a payload, so
 * `MenuBridge` subscribes to it separately rather than through the plain
 * command loop. It is allow-listed by name here so that a NEW asymmetry still
 * fails rather than being waved through.
 */
const PAYLOAD_EVENT = 'open-payload';

function rustSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return rustSourceFiles(path);
    return e.isFile() && e.name.endsWith('.rs') ? [path] : [];
  });
}

function eventsEmittedFromRust(): Set<string> {
  const found = new Set<string>();
  for (const file of rustSourceFiles(join(process.cwd(), 'src-tauri', 'src'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/menu:\/\/([a-z-]+)/g)) found.add(m[1]);
  }
  return found;
}

describe('the Rust↔frontend menu-event contract', () => {
  it('finds the Rust sources at all (guards against a vacuous pass)', () => {
    // Without this, a wrong path would make `eventsEmittedFromRust()` return an
    // empty set and every assertion below would pass by finding nothing.
    const files = rustSourceFiles(join(process.cwd(), 'src-tauri', 'src'));
    expect(files.length).toBeGreaterThan(3);
    expect(eventsEmittedFromRust().size).toBeGreaterThan(5);
  });

  it('every menu:// event Rust emits has a frontend listener', () => {
    const commands = new Set<string>(MENU_COMMANDS);
    const orphans = [...eventsEmittedFromRust()]
      .filter((e) => e !== PAYLOAD_EVENT && !commands.has(e));
    expect(
      orphans,
      `Rust emits menu://${orphans.join(', menu://')} but MENU_COMMANDS has no such command, `
      + 'so the menu item would do nothing. Add it to MENU_COMMANDS (and a handler + '
      + 'dispatch case), or stop emitting it.',
    ).toEqual([]);
  });

  it('every frontend command is actually emitted by Rust', () => {
    // The mirror failure: a command the frontend listens for that nothing ever
    // sends. Harmless at runtime but it means a handler is dead code, and it
    // usually signals a rename that only landed on one side.
    const emitted = eventsEmittedFromRust();
    const unheard = MENU_COMMANDS.filter((c) => !emitted.has(c));
    expect(
      unheard,
      `MENU_COMMANDS lists ${unheard.join(', ')} but no Rust source emits menu://<that>, `
      + 'so the handler can never run.',
    ).toEqual([]);
  });

  it('covers the two writing-mode commands specifically (6c-ii-b, D-A)', () => {
    // These are the reason this file exists: 6c-ii handled them entirely in
    // Rust with no frontend listener at all, and per-window state moved them
    // onto the event path. A regression here is the ⌥⌘F defect exactly.
    const emitted = eventsEmittedFromRust();
    for (const cmd of ['toggle-typewriter', 'toggle-focus'] as const) {
      expect(emitted.has(cmd), `Rust must emit menu://${cmd}`).toBe(true);
      expect(MENU_COMMANDS as readonly string[]).toContain(cmd);
    }
  });
});
