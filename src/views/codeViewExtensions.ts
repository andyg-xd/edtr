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
import { highlightSelectionMatches, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import type { EditorFormat } from '../files/fileTypes';
import { darkEditorTheme, darkHighlightStyle } from './codeTheme';
import type { EffectiveTheme } from '../settings/theme';
import { findHighlightField } from '../find/codeSurface';

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
 *
 * CodeMirror's own search panel is never installed and never opened (search()
 * is absent, and nothing here calls openSearchPanel) — so its invisible close
 * button (6c-i-a's motivating defect) can never appear.
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
    // Find highlighting, installed at construction: a StateField cannot join a
    // running editor without appendConfig, and configuring an editor at runtime
    // is the kind of thing that works until it doesn't.
    findHighlightField,
    // CodeMirror's searchKeymap is REPLACED by an explicit selection, not
    // dropped wholesale, so nothing disappears by accident (design §5.6).
    // Dropped: Mod-f (the native Edit menu owns it), Mod-g / Shift-Mod-g / F3
    // (they navigate CodeMirror's internal query, which our bar never sets),
    // Escape (our bar owns it), Mod-Alt-g (go to line is a non-goal, and its
    // dialog ships the same unstyled buttons this phase removes). Kept: Mod-d
    // and Mod-Shift-l, which work off the selection and are unrelated to the
    // panel — dropping them would silently remove shortcuts that work today.
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
      { key: 'Mod-Shift-l', run: selectSelectionMatches, preventDefault: true },
    ]),
  ];
}
