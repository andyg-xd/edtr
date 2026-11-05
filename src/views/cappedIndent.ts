import { EditorSelection, EditorState, Text, countColumn, type StateCommand } from '@codemirror/state';
import {
  IndentContext,
  getIndentation,
  getIndentUnit,
  indentString,
  syntaxTree,
} from '@codemirror/language';
import { NodeProp } from '@lezer/common';

const MAX_EXTRA_UNITS = 2;

// Mirrors the (unexported) helper behind CodeMirror's own Enter: a caret
// between a bracket pair opens the pair onto its own line.
function betweenBrackets(state: Parameters<StateCommand>[0]['state'], pos: number) {
  if (/\(\)|\[\]|\{\}/.test(state.sliceDoc(pos - 1, pos + 1))) return { from: pos, to: pos };
  const context = syntaxTree(state).resolveInner(pos);
  const before = context.childBefore(pos);
  const after = context.childAfter(pos);
  const closedBy = before && after && before.type.prop(NodeProp.closedBy);
  if (
    before && after && closedBy &&
    before.to <= pos && after.from >= pos &&
    closedBy.indexOf(after.name) > -1 &&
    state.doc.lineAt(before.to).from === state.doc.lineAt(after.from).from &&
    !/\S/.test(state.sliceDoc(before.to, after.from))
  ) {
    return { from: before.to, to: after.from };
  }
  return null;
}

// Smart indent for a new line at `from`, kept only while it stays within
// MAX_EXTRA_UNITS indent units of the line's own indentation.
function chosenIndent(state: EditorState, cx: IndentContext, from: number, leading: string): string {
  const computed = getIndentation(cx, from);
  const own = countColumn(leading, state.tabSize);
  const maxExtra = MAX_EXTRA_UNITS * getIndentUnit(state);
  return computed != null && computed <= own + maxExtra ? indentString(state, computed) : leading;
}

/**
 * Return in Code view: the language's smart indent, kept only while it stays
 * within two indent units of the current line's own indentation. A language
 * service that computes thousands of columns (minified CSS) would otherwise
 * insert thousands of spaces; past the cap, or with no answer, the new line
 * copies the current line's leading whitespace byte for byte. Dedents pass.
 */
export const newlineAndCappedIndent: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const changes = state.changeByRange((range) => {
    let { from, to } = range;
    const line = state.doc.lineAt(from);
    const explode = from === to ? betweenBrackets(state, from) : null;
    const cx = new IndentContext(state, { simulateBreak: from, simulateDoubleBreak: !!explode });
    const leading = /^\s*/.exec(line.text)![0];
    const indent = chosenIndent(state, cx, from, leading);
    while (to < line.to && /\s/.test(line.text[to - line.from])) to++;
    if (explode) ({ from, to } = explode);
    else if (from > line.from && from < line.from + 100 && !/\S/.test(line.text.slice(0, from))) from = line.from;
    const insert = ['', indent];
    if (explode) insert.push(indentString(state, cx.lineIndent(line.from, -1)));
    return {
      changes: { from, to, insert: Text.of(insert) },
      range: EditorSelection.cursor(from + 1 + indent.length),
    };
  });
  dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }));
  return true;
};

/**
 * Mod-Return in Code view: a new line below, with the same capped indent as
 * Return. Mirrors CodeMirror's insertBlankLine, which moves each cursor to
 * its line's end first.
 */
export const blankLineAndCappedIndent: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const changes = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.to <= state.doc.lineAt(range.from).to ? range.from : range.to);
    const from = line.to;
    const cx = new IndentContext(state, { simulateBreak: from });
    const leading = /^\s*/.exec(line.text)![0];
    const indent = chosenIndent(state, cx, from, leading);
    return {
      changes: { from, to: from, insert: Text.of(['', indent]) },
      range: EditorSelection.cursor(from + 1 + indent.length),
    };
  });
  dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }));
  return true;
};
