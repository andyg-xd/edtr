// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState, type StateCommand } from '@codemirror/state';
import { indentService } from '@codemirror/language';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { buildCodeViewExtensions } from './codeViewExtensions';
import { newlineAndCappedIndent, blankLineAndCappedIndent } from './cappedIndent';
import type { EditorFormat } from '../files/fileTypes';

function pressKey(key: string, format: EditorFormat, doc: string, pos: number): string {
  const view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor: pos }, extensions: buildCodeViewExtensions(format) }),
  });
  const enter = view.state.facet(keymap).flat().find((b) => b.key === key)!;
  enter.run!(view);
  const out = view.state.doc.toString();
  view.destroy();
  return out;
}

const pressEnter = (format: EditorFormat, doc: string, pos: number) => pressKey('Enter', format, doc, pos);
const pressModEnter = (format: EditorFormat, doc: string, pos: number) => pressKey('Mod-Enter', format, doc, pos);

const rules = Array.from({ length: 400 }, (_, i) => `.r${i}{color:red}`).join('');
const minified = `<style>\n${rules}</style>`;
const mid = minified.indexOf('.r300{');

describe('Return in Code view (capped smart indent)', () => {
  it('does not insert thousands of spaces inside minified CSS', () => {
    expect(pressEnter('html', minified, mid)).toBe(minified.slice(0, mid) + '\n' + minified.slice(mid));
  });

  it('keeps the computed one-level indent in tidy HTML', () => {
    const doc = '  <div></div>';
    const pos = '  <div>'.length;
    const out = pressEnter('html', doc, pos);
    expect(out).toBe('  <div>\n    \n  </div>');
  });

  it('copies a tab-indented line\'s tab when falling back', () => {
    const doc = minified.replace('<style>\n', '<style>\n\t');
    const pos = mid + 1;
    expect(pressEnter('html', doc, pos)).toBe(doc.slice(0, pos) + '\n\t' + doc.slice(pos));
  });

  it('changes nothing besides the inserted line break (plaintext keeps leading whitespace)', () => {
    const doc = '  abc\nxyz';
    expect(pressEnter('plaintext', doc, 5)).toBe('  abc\n  \nxyz');
  });

  it('opens a bracket pair onto its own line', () => {
    expect(pressEnter('html', '<style>.a{}</style>', '<style>.a{'.length)).toBe('<style>.a{\n  \n}</style>');
  });

  it('is the Enter binding, ahead of the default keymap', () => {
    const bindings = EditorState.create({ extensions: buildCodeViewExtensions('markdown') })
      .facet(keymap).flat().filter((b) => b.key === 'Enter');
    expect(bindings[0].run).toBe(newlineAndCappedIndent);
    expect(defaultKeymap.some((b) => b.key === 'Enter')).toBe(true);
  });

  it('opens a blank line below with the computed indent on a tidy line (Mod-Enter)', () => {
    expect(pressModEnter('html', '<div>', 2)).toBe('<div>\n  ');
  });

  it('does not insert thousands of spaces inside minified CSS (Mod-Enter)', () => {
    const doc = `<style>\n${rules}\n</style>`;
    const lineEnd = doc.indexOf('\n', 8);
    expect(pressModEnter('html', doc, 8 + 300)).toBe(doc.slice(0, lineEnd) + '\n' + doc.slice(lineEnd));
  });

  it('is the Mod-Enter binding, ahead of the default keymap', () => {
    const bindings = EditorState.create({ extensions: buildCodeViewExtensions('markdown') })
      .facet(keymap).flat().filter((b) => b.key === 'Mod-Enter');
    expect(bindings[0].run).toBe(blankLineAndCappedIndent);
  });
});

describe('the indent cap boundary', () => {
  function withComputed(computed: number, command: StateCommand, doc = '  abc'): string {
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [indentService.of(() => computed)],
    });
    let out = doc;
    command({ state, dispatch: (tr) => { out = tr.state.doc.toString(); } });
    return out;
  }

  for (const [name, command] of [['Enter', newlineAndCappedIndent], ['Mod-Enter', blankLineAndCappedIndent]] as const) {
    it(`${name}: keeps a computed indent exactly two units past the line's own`, () => {
      expect(withComputed(6, command)).toBe('  abc\n      ');
    });

    it(`${name}: falls back to the line's own whitespace one column past the cap`, () => {
      expect(withComputed(7, command)).toBe('  abc\n  ');
    });

    it(`${name}: keeps a dedent`, () => {
      expect(withComputed(0, command)).toBe('  abc\n');
    });
  }
});
