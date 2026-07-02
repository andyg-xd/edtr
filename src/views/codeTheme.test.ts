// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { syntaxHighlighting } from '@codemirror/language';
import { darkEditorTheme, darkHighlightStyle } from './codeTheme';

describe('codeTheme (dark)', () => {
  it('exports a valid EditorView theme + HighlightStyle usable as extensions', () => {
    const state = EditorState.create({
      doc: '# heading\n',
      extensions: [darkEditorTheme, syntaxHighlighting(darkHighlightStyle)],
    });
    // Building the state proves the extensions are well-formed; content is inert.
    expect(state.doc.toString()).toBe('# heading\n');
  });
});
