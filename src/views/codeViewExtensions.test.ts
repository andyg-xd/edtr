// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { buildCodeViewExtensions, themeCompartment, themeExtensionFor } from './codeViewExtensions';

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
