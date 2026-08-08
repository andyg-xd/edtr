// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
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

  it('renders highlights as <edtr-mark>, never as a bare <span>', () => {
    // HTML Live renders the FILE's own CSS, by design. A bare <span> is
    // therefore a selector collision waiting to happen: a real document styled
    // `ul.notice li span{position:absolute;left:14px;top:11px}` (to place a `→`
    // bullet) yanked the highlighted word clean out of the text flow and parked
    // it on top of the arrow -- the word simply vanished from its sentence.
    // Source order cannot fix that: `ul.notice li span` is (0,1,3) and beats
    // `.edtr-find` (0,1,0) whatever the order. A custom element name the file
    // cannot know about is what actually removes the collision.
    const v = mount('aaa');
    pmSurface(v).highlight([{ from: 1, to: 2 }], 0);
    const el = v.dom.querySelector('.edtr-find')!;
    expect(el.tagName.toLowerCase()).toBe('edtr-mark');
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
    let sawTransaction = false;
    v.setProps({
      dispatchTransaction(tr) {
        sawTransaction = true;
        if (tr.docChanged) sawDocChange = true;
        v!.updateState(v!.state.apply(tr));
      },
    });
    pmSurface(v).highlight([{ from: 1, to: 2 }], 0);
    // Both halves matter: without `sawTransaction`, a `highlight()` that
    // dispatched NOTHING would pass this test too — it needs to have actually
    // run through `dispatchTransaction` and still report no doc change.
    expect(sawTransaction).toBe(true);
    expect(sawDocChange).toBe(false);
  });

  it('reveal selects the match so closing the bar leaves the cursor there', () => {
    const v = mount('hello world');
    pmSurface(v).reveal({ from: 7, to: 12 });
    expect(v.state.selection.from).toBe(7);
    expect(v.state.selection.to).toBe(12);
  });

  it('scrolls the match into view even while focus sits in the find field', () => {
    // ProseMirror's own `tr.scrollIntoView()` starts from the DOM selection's
    // focusNode and does NOTHING, silently, when that node is not inside the
    // editor (prosemirror-view's `scrollToSelection`). Focus is in the find
    // field for every keystroke and every Cmd-G, so that is ALWAYS the case
    // here: the match was found and highlighted, and the viewport never moved.
    // This surface therefore scrolls explicitly instead of asking ProseMirror.
    //
    // jsdom implements no scrolling whatsoever -- `scrollIntoView` is absent,
    // not just inert -- which is exactly why the suite could not see the bug.
    const v = mount('hello world');
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus(); // model the find field owning focus

    const scrolled: Element[] = [];
    const proto = Element.prototype as unknown as { scrollIntoView?: () => void };
    const original = proto.scrollIntoView;
    proto.scrollIntoView = function (this: Element) { scrolled.push(this); };
    try {
      pmSurface(v).reveal({ from: 7, to: 12 });
    } finally {
      if (original) proto.scrollIntoView = original;
      else delete proto.scrollIntoView;
      field.remove();
    }

    expect(scrolled.length).toBeGreaterThan(0);
    // ...and it scrolled the element holding the match, not some outer box.
    expect(v.dom.contains(scrolled[0])).toBe(true);
    expect(scrolled[0].textContent).toContain('world');
  });

  it('does not try to scroll a match that outlived the document', () => {
    // The bounds guard must come first: a dead position has no DOM node, so
    // reaching for one would be the crash the guard exists to prevent.
    const v = mount('short');
    const proto = Element.prototype as unknown as { scrollIntoView?: () => void };
    const original = proto.scrollIntoView;
    const spy = vi.fn();
    proto.scrollIntoView = spy;
    try {
      expect(() => pmSurface(v).reveal({ from: 100, to: 120 })).not.toThrow();
    } finally {
      if (original) proto.scrollIntoView = original;
      else delete proto.scrollIntoView;
    }
    expect(spy).not.toHaveBeenCalled();
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

  it('maps and reveals a match that spans an excluded atom', () => {
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
    // The image contributes no text but DOES occupy a position, so the match's
    // end is past where plain string arithmetic would put it. That offset is
    // what the map exists to get right, and it is what this test guards.
    expect(run.matches).toEqual([{ from: 1, to: 5 }]);
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

  it('ignores a match that outlived the document instead of throwing', () => {
    // A match can outlive the document it was computed against: the recompute
    // is debounced, so a shrinking edit plus a Cmd-G can reach reveal() with a
    // dead position. `.resolve()` throws a RangeError on an out-of-bounds
    // position, and this throws out of a React passive effect if it is not
    // contained here -- which takes the whole window down. A stale reveal must
    // do nothing, silently.
    const v = mount('short');
    const before = v.state.doc;
    const beforeSelection = v.state.selection.from;
    expect(() => pmSurface(v).reveal({ from: 100, to: 120 })).not.toThrow();
    expect(v.state.selection.from).toBe(beforeSelection); // moved nothing
    expect(v.state.doc.eq(before)).toBe(true);
  });
});
