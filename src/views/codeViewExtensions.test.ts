// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { buildCodeViewExtensions } from './codeViewExtensions';

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
});
