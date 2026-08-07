// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { liveSchema } from '../views/liveSchema';
import { dirtyTrackingPlugin, getDirtyBlockIds } from '../views/dirtyTracking';
import { blockIdentityPlugin } from '../views/blockIdentity';
import { findDecorationsPlugin, pmSurface } from './pmSurface';
import { matchSegments } from './matchText';
import { emptyQuery } from './findQuery';

const s = liveSchema;
let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; });

function mount(text: string, extra: unknown[] = []): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const doc = s.node('doc', null, [
    s.node('paragraph', { blockId: 'b0' }, [s.text(text)]),
  ]);
  view = new EditorView(host, {
    state: EditorState.create({
      doc,
      plugins: [findDecorationsPlugin(), ...(extra as never[])],
    }),
  });
  return view;
}

const highlightSpans = (v: EditorView) => v.dom.querySelectorAll('.edtr-find');

describe('pmSurface', () => {
  it('segments per block and declares itself NOT multiline', () => {
    const surface = pmSurface(mount('hello world'));
    expect(surface.getSegments().map((x) => x.text)).toEqual(['hello world']);
    // Per-block segments ⇒ ^/$ anchor to BLOCKS here (design §5.3).
    expect(surface.multiline).toBe(false);
  });

  it('renders a decoration per match', () => {
    const v = mount('aaa');
    pmSurface(v).highlight([{ from: 1, to: 2 }, { from: 2, to: 3 }], 0);
    expect(highlightSpans(v).length).toBe(2);
  });

  it('marks only the current match as current', () => {
    const v = mount('aaa');
    pmSurface(v).highlight([{ from: 1, to: 2 }, { from: 2, to: 3 }], 1);
    expect(v.dom.querySelectorAll('.edtr-find-current').length).toBe(1);
  });

  it('replaces the previous highlights rather than adding to them', () => {
    const v = mount('aaa');
    const surface = pmSurface(v);
    surface.highlight([{ from: 1, to: 2 }, { from: 2, to: 3 }], 0);
    surface.highlight([{ from: 3, to: 4 }], 0);
    expect(highlightSpans(v).length).toBe(1);
  });

  it('clears highlights when given none', () => {
    const v = mount('abc');
    const surface = pmSurface(v);
    surface.highlight([{ from: 1, to: 2 }], 0);
    surface.highlight([], -1);
    expect(highlightSpans(v).length).toBe(0);
  });

  it('NEVER changes the document, and never marks a block dirty', () => {
    // The load-bearing invariant: highlighting is decoration, and decoration
    // must be invisible to dirty tracking (design §6).
    const v = mount('hello world', [blockIdentityPlugin(), dirtyTrackingPlugin()]);
    const before = v.state.doc;
    const surface = pmSurface(v);
    surface.highlight([{ from: 7, to: 12 }], 0);
    surface.reveal({ from: 7, to: 12 });
    expect(v.state.doc.eq(before)).toBe(true);
    expect(getDirtyBlockIds(v.state).size).toBe(0);
  });

  it('a highlight transaction reports no document change', () => {
    const v = mount('abc');
    let sawDocChange = false;
    const original = v.dispatch.bind(v);
    v.setProps({
      dispatchTransaction(tr) {
        if (tr.docChanged) sawDocChange = true;
        v!.updateState(v!.state.apply(tr));
      },
    });
    pmSurface(v).highlight([{ from: 1, to: 2 }], 0);
    expect(sawDocChange).toBe(false);
    void original;
  });

  it('reveal selects the match so closing the bar leaves the cursor there', () => {
    const v = mount('hello world');
    pmSurface(v).reveal({ from: 7, to: 12 });
    expect(v.state.selection.from).toBe(7);
    expect(v.state.selection.to).toBe(12);
  });

  it('reports the cursor position and the selected text', () => {
    const v = mount('hello world');
    const surface = pmSurface(v);
    // reveal() is the selection-setter this surface owns — use it rather than
    // hand-building a TextSelection, so the test exercises the real path.
    surface.reveal({ from: 1, to: 6 }); // positions 1..6 == "hello"
    expect(surface.cursorPos()).toBe(6);
    expect(surface.selectedText()).toBe('hello');
  });

  it('reports empty selected text for a bare cursor', () => {
    const v = mount('hello');
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 3)));
    expect(pmSurface(v).selectedText()).toBe('');
  });

  it('survives a match whose endpoints are not both plain text positions', () => {
    // A match that spans an excluded image has endpoints PM may not accept as
    // a strict TextSelection. It must not throw — find has to keep working.
    const doc = s.node('doc', null, [
      s.node('paragraph', { blockId: 'b0' }, [
        s.text('ca'), s.node('image', { src: 'x.png' }), s.text('t'),
      ]),
    ]);
    const host = document.createElement('div');
    document.body.appendChild(host);
    view = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [findDecorationsPlugin()] }),
    });
    const surface = pmSurface(view);
    const run = matchSegments(surface.getSegments(), { ...emptyQuery, text: 'cat' }, { multiline: false });
    expect(run.matches.length).toBe(1);
    expect(() => {
      surface.highlight(run.matches, 0);
      surface.reveal(run.matches[0]);
    }).not.toThrow();
  });

  it('keeps highlights on their text when the document changes ahead of them', () => {
    const v = mount('one two');
    pmSurface(v).highlight([{ from: 5, to: 8 }], 0);
    v.dispatch(v.state.tr.insertText('XX', 1, 1));
    const span = highlightSpans(v)[0];
    expect(span?.textContent).toBe('two');
  });
});
