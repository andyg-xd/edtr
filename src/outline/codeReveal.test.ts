// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { revealSourceInCode } from './codeReveal';
import type { OutlineEntry } from './types';

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; });

function mount(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  view = new EditorView({ state: EditorState.create({ doc }), parent });
  return view;
}

const entry = (srcFrom: number, srcTo: number): OutlineEntry => ({
  id: 'n0', level: 2, text: 'Section', srcFrom, srcTo,
  ordinalInBlock: 0, blockFrom: srcFrom, blockTo: srcTo,
});

describe('revealSourceInCode', () => {
  it('puts the selection on the heading', () => {
    const doc = '# Title\n\n## Section\n';
    const v = mount(doc);
    revealSourceInCode(v, entry(9, 19));
    expect(v.state.selection.main.from).toBe(9);
    expect(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)).toBe('## Section');
  });

  it('does nothing when the entry points past the end of the document', () => {
    const v = mount('short\n');
    expect(() => revealSourceInCode(v, entry(500, 520))).not.toThrow();
    expect(v.state.selection.main.from).toBe(0);
  });
});
