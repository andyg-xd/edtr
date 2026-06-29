import { EditorState, type Extension } from '@codemirror/state';
import {
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  keymap,
} from '@codemirror/view';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { bracketMatching, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import type { EditorFormat } from '../files/fileTypes';

function languageExtension(format: EditorFormat): Extension {
  if (format === 'markdown') return markdown();
  if (format === 'html') return html();
  return [];
}

/**
 * The Code view extension set. NO-BEAUTIFY: this deliberately omits
 * indentOnInput, closeBrackets, and autocompletion — nothing here inserts or
 * rewrites bytes the user didn't type. lineSeparator is pinned to '\n' so the
 * editor never reinterprets line endings (Rust owns EOL fidelity).
 */
export function buildCodeViewExtensions(format: EditorFormat): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    history(),
    bracketMatching(),
    highlightSelectionMatches(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorState.lineSeparator.of('\n'),
    languageExtension(format),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
  ];
}
