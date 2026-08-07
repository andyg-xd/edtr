// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { buildCodeViewExtensions } from '../views/codeViewExtensions';
import { codeSurface, findHighlightField } from './codeSurface';
import { matchSegments } from './matchText';
import { emptyQuery } from './findQuery';

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; });

function mount(doc: string): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  view = new EditorView({
    parent: host,
    state: EditorState.create({ doc, extensions: buildCodeViewExtensions('markdown') }),
  });
  return view;
}

function decorationCount(v: EditorView): number {
  let n = 0;
  v.state.field(findHighlightField).between(0, v.state.doc.length, () => { n += 1; });
  return n;
}

describe('codeSurface', () => {
  it('returns ONE segment holding the raw source', () => {
    const v = mount('**bold** text');
    const segments = codeSurface(v).getSegments();
    expect(segments.length).toBe(1);
    // The asterisks are searchable here — that is the point of Code view.
    expect(segments[0].text).toBe('**bold** text');
  });

  it('declares itself multiline, so ^ anchors per line', () => {
    expect(codeSurface(mount('a\nb')).multiline).toBe(true);
  });

  it('maps a match straight onto document offsets', () => {
    const v = mount('hello world');
    const surface = codeSurface(v);
    const run = matchSegments(surface.getSegments(), { ...emptyQuery, text: 'world' }, { multiline: true });
    expect(run.matches).toEqual([{ from: 6, to: 11 }]);
  });

  it('adds a decoration per match and replaces them on the next call', () => {
    const v = mount('aaa');
    const surface = codeSurface(v);
    surface.highlight([{ from: 0, to: 1 }, { from: 1, to: 2 }], 0);
    expect(decorationCount(v)).toBe(2);
    surface.highlight([{ from: 2, to: 3 }], 0);
    expect(decorationCount(v)).toBe(1); // replaced, not appended
  });

  it('clears highlights when given none', () => {
    const v = mount('abc');
    const surface = codeSurface(v);
    surface.highlight([{ from: 0, to: 1 }], 0);
    surface.highlight([], -1);
    expect(decorationCount(v)).toBe(0);
  });

  it('NEVER changes the document — not when highlighting, not when revealing', () => {
    // 6c-i-a cannot modify a file at all (design §6).
    const v = mount('hello world');
    const surface = codeSurface(v);
    surface.highlight([{ from: 6, to: 11 }], 0);
    surface.reveal({ from: 6, to: 11 });
    expect(v.state.doc.toString()).toBe('hello world');
  });

  it('reveal selects the match, so closing the bar leaves the cursor there', () => {
    const v = mount('hello world');
    codeSurface(v).reveal({ from: 6, to: 11 });
    expect(v.state.selection.main.from).toBe(6);
    expect(v.state.selection.main.to).toBe(11);
  });

  it('reports the cursor position and the selected text', () => {
    const v = mount('hello world');
    v.dispatch({ selection: { anchor: 0, head: 5 } });
    const surface = codeSurface(v);
    expect(surface.cursorPos()).toBe(5);
    expect(surface.selectedText()).toBe('hello');
  });

  it('reports empty selected text for a bare cursor', () => {
    const v = mount('hello');
    v.dispatch({ selection: { anchor: 2, head: 2 } });
    expect(codeSurface(v).selectedText()).toBe('');
  });

  it('keeps highlights on their text when the document changes ahead of them', () => {
    // Without mapping, typing at the top would leave every highlight pointing
    // at whatever slid into those offsets.
    const v = mount('one two');
    codeSurface(v).highlight([{ from: 4, to: 7 }], 0);
    v.dispatch({ changes: { from: 0, insert: 'XX' } });
    let found: { from: number; to: number } | null = null;
    v.state.field(findHighlightField).between(0, v.state.doc.length, (from, to) => { found = { from, to }; });
    expect(found).toEqual({ from: 6, to: 9 });
  });
});
