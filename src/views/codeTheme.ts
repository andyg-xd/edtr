import { EditorView } from '@codemirror/view';
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/**
 * Hand-rolled CodeMirror dark theme, matched to Edtr's soft-dark-gray palette
 * (base #1e1e1e) so Code view and the CSS shell read as one surface. Light mode
 * keeps @codemirror/language's defaultHighlightStyle (see codeViewExtensions).
 */
export const darkEditorTheme = EditorView.theme(
  {
    '&': { color: '#e4e4e4', backgroundColor: '#1e1e1e' },
    '.cm-content': { caretColor: '#e4e4e4' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#e4e4e4' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(80, 130, 190, 0.35)',
    },
    '.cm-selectionMatch': { backgroundColor: 'rgba(120, 160, 210, 0.25)' },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.04)' },
    '.cm-gutters': { backgroundColor: '#1e1e1e', color: '#6f6f6f', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255, 255, 255, 0.04)', color: '#cfcfcf' },
    '.cm-matchingBracket, .cm-nonmatchingBracket': {
      backgroundColor: 'rgba(255, 255, 255, 0.12)',
      outline: '1px solid rgba(255, 255, 255, 0.25)',
    },
  },
  { dark: true },
);

export const darkHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#569cd6' },
  { tag: [t.name, t.propertyName, t.variableName, t.attributeName], color: '#9cdcfe' },
  { tag: [t.function(t.variableName)], color: '#dcdcaa' },
  { tag: [t.number, t.bool, t.atom, t.constant(t.name)], color: '#b5cea8' },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape, t.url], color: '#ce9178' },
  { tag: [t.comment, t.meta], color: '#6a9955', fontStyle: 'italic' },
  { tag: t.operator, color: '#d4d4d4' },
  { tag: [t.tagName, t.processingInstruction, t.inserted], color: '#569cd6' },
  { tag: [t.typeName, t.className], color: '#4ec9b0' },
  { tag: t.heading, fontWeight: 'bold', color: '#e4e4e4' },
  { tag: t.link, textDecoration: 'underline', color: '#4c8ed6' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
]);
