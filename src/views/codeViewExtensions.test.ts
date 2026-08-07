// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import {
  selectNextOccurrence,
  selectSelectionMatches,
  openSearchPanel,
  findNext,
  findPrevious,
  gotoLine,
  closeSearchPanel,
} from '@codemirror/search';
import { buildCodeViewExtensions, themeCompartment, themeExtensionFor } from './codeViewExtensions';
import { findHighlightField } from '../find/codeSurface';

describe('buildCodeViewExtensions', () => {
  it('round-trips \\n text unchanged (lineSeparator is \\n)', () => {
    const doc = 'line1\nline2\n';
    const state = EditorState.create({ doc, extensions: buildCodeViewExtensions('markdown') });
    expect(state.doc.toString()).toBe(doc);
    expect(state.doc.lines).toBe(3); // "line1", "line2", ""
  });

  it('treats a lone CR as content, not a line break', () => {
    const doc = 'a\rb';
    const state = EditorState.create({ doc, extensions: buildCodeViewExtensions('plaintext') });
    expect(state.doc.toString()).toBe(doc);
    expect(state.doc.lines).toBe(1);
  });

  it('builds for html without throwing', () => {
    const state = EditorState.create({ doc: '<p>x</p>\n', extensions: buildCodeViewExtensions('html') });
    expect(state.doc.toString()).toBe('<p>x</p>\n');
  });

  it('does not bind Enter to markdown markup-continuation (no format-on-type)', () => {
    const enterRuns = (exts: any) =>
      EditorState.create({ extensions: exts })
        .facet(keymap)
        .flat()
        .filter((b: any) => b.key === 'Enter' && b.run)
        .map((b: any) => b.run);

    const defaultMd = enterRuns([markdown()]);            // default pack: has the continuation command
    const ours = enterRuns(buildCodeViewExtensions('markdown'));

    expect(defaultMd.length).toBeGreaterThan(0);          // sanity: default DOES bind Enter
    for (const run of defaultMd) {
      expect(ours).not.toContain(run);                    // ours must not include the pack's Enter command
    }
  });
});

describe('theme compartment', () => {
  it('builds a dark editor and round-trips text unchanged', () => {
    const doc = 'a\nb\n';
    const state = EditorState.create({ doc, extensions: buildCodeViewExtensions('markdown', 'dark') });
    expect(state.doc.toString()).toBe(doc);
  });

  it('defaults to light when no effective theme is passed', () => {
    // Existing callers pass no second arg; this must keep working (no throw).
    const state = EditorState.create({ doc: 'x\n', extensions: buildCodeViewExtensions('markdown') });
    expect(state.doc.toString()).toBe('x\n');
  });

  it('themeExtensionFor is reconfigurable via the compartment', () => {
    const state = EditorState.create({ doc: 'x\n', extensions: buildCodeViewExtensions('markdown', 'light') });
    const effect = themeCompartment.reconfigure(themeExtensionFor('dark'));
    const next = state.update({ effects: effect }).state;
    expect(next.doc.toString()).toBe('x\n'); // reconfigure is content-preserving
  });
});

describe('CodeMirror search disposition (6c-i-a §5.6)', () => {
  const bindings = () =>
    EditorState.create({ extensions: buildCodeViewExtensions('markdown') })
      .facet(keymap)
      .flat() as Array<{ key?: string; run?: unknown; shift?: unknown }>;

  const boundKeys = () => bindings().map((b) => b.key).filter(Boolean) as string[];

  it('does NOT bind Mod-f — the native Edit menu owns it', () => {
    // macOS offers a key equivalent to the menu FIRST, so a webview binding
    // would never fire; binding it in both places double-handles.
    expect(boundKeys()).not.toContain('Mod-f');
  });

  it('installs NONE of CodeMirror search\'s panel commands', () => {
    // Asserted by RUN-FUNCTION IDENTITY, not by key string. CodeMirror
    // synthesizes shift variants from a `shift:` property on the base binding
    // at keydown time, so a literal 'Shift-Mod-g' key NEVER appears in the
    // extension array -- asserting on that string can never fail, whatever is
    // bound. Identity closes that hole and covers every alias at once
    // (Mod-g/F3 share one run function, as do Shift-Mod-g/Shift-F3).
    const runs = bindings().flatMap((b) => [b.run, (b as { shift?: unknown }).shift]);
    for (const command of [openSearchPanel, findNext, findPrevious, gotoLine, closeSearchPanel]) {
      expect(runs, command.name).not.toContain(command);
    }
  });

  it('does NOT bind Mod-g, Mod-Alt-g, or F3', () => {
    // These read CodeMirror's INTERNAL query, which our bar never sets, so
    // leaving them would navigate a different search than the one on screen.
    const keys = boundKeys();
    expect(keys).not.toContain('Mod-g');
    expect(keys).not.toContain('Mod-Alt-g');
    expect(keys).not.toContain('F3');
  });

  it('leaves Escape to defaultKeymap, never to closeSearchPanel', () => {
    // Escape IS legitimately bound (defaultKeymap -> simplifySelection), so the
    // key must NOT be asserted absent -- what must be absent is search's panel
    // command. Our find bar owns Escape at the React layer.
    expect(bindings().filter((b) => b.key === 'Escape').map((b) => b.run))
      .not.toContain(closeSearchPanel);
  });

  it('KEEPS Mod-d and Mod-Shift-l — they work off the selection', () => {
    const keys = boundKeys();
    expect(keys).toContain('Mod-d');
    expect(keys).toContain('Mod-Shift-l');
    const runs = bindings().filter((b) => b.key === 'Mod-d').map((b) => b.run);
    expect(runs).toContain(selectNextOccurrence);
    const shiftLRuns = bindings().filter((b) => b.key === 'Mod-Shift-l').map((b) => b.run);
    expect(shiftLRuns).toContain(selectSelectionMatches);
  });

  it('installs the find-highlight field so it never needs appendConfig', () => {
    const state = EditorState.create({ doc: 'abc', extensions: buildCodeViewExtensions('markdown') });
    expect(state.field(findHighlightField, false)).toBeDefined();
  });
});
