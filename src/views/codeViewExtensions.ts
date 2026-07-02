import { EditorState, Compartment, type Extension } from '@codemirror/state';
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
import { darkEditorTheme, darkHighlightStyle } from './codeTheme';
import type { EffectiveTheme } from '../settings/theme';

function languageExtension(format: EditorFormat): Extension {
  // Disable the language packs' own format-on-type: markdown's addKeymap
  // (Enter→list/blockquote continuation, Backspace→delete-markup) and HTML's
  // autoCloseTags (auto-insert closing tag). No-beautify = the editor never
  // inserts bytes the user didn't type.
  if (format === 'markdown') return markdown({ addKeymap: false, completeHTMLTags: false });
  if (format === 'html') return html({ autoCloseTags: false });
  return [];
}

/**
 * The CodeMirror theme lives in a Compartment so CodeView can swap light/dark
 * in place (reconfigure) without recreating the EditorView — cursor, selection,
 * and undo history are preserved. Light keeps the default highlight style;
 * dark uses the hand-rolled theme (codeTheme.ts).
 */
export const themeCompartment = new Compartment();

export function themeExtensionFor(effective: EffectiveTheme): Extension {
  return effective === 'dark'
    ? [darkEditorTheme, syntaxHighlighting(darkHighlightStyle)]
    : [syntaxHighlighting(defaultHighlightStyle, { fallback: true })];
}

/**
 * The Code view extension set. NO-BEAUTIFY: this deliberately omits
 * indentOnInput, closeBrackets, and autocompletion — nothing here inserts or
 * rewrites bytes the user didn't type. lineSeparator is pinned to '\n' so the
 * editor never reinterprets line endings (Rust owns EOL fidelity).
 *
 * Language packs are included for syntax highlighting only. Their built-in
 * format-on-type behaviours are explicitly disabled: markdown({ addKeymap:
 * false }) removes the Enter→markup-continuation and Backspace→delete-markup
 * bindings; html({ autoCloseTags: false }) removes the auto-closing-tag input
 * handler. The inert contract (§5.1) holds across all formats.
 */
export function buildCodeViewExtensions(
  format: EditorFormat,
  effective: EffectiveTheme = 'light',
): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    history(),
    bracketMatching(),
    highlightSelectionMatches(),
    themeCompartment.of(themeExtensionFor(effective)),
    EditorState.lineSeparator.of('\n'),
    languageExtension(format),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
  ];
}
