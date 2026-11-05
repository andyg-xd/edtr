// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { buildCodeViewExtensions } from './codeViewExtensions';
import { newlineAndCappedIndent } from './cappedIndent';
import type { EditorFormat } from '../files/fileTypes';

function pressEnter(format: EditorFormat, doc: string, pos: number): string {
  const view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor: pos }, extensions: buildCodeViewExtensions(format) }),
  });
  const enter = view.state.facet(keymap).flat().find((b) => b.key === 'Enter')!;
  enter.run!(view);
  const out = view.state.doc.toString();
  view.destroy();
  return out;
}

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
});
