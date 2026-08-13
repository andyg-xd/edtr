// src/writingmodes/pmFocus.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { liveSchema } from '../views/liveSchema';
import { focusDimPlugin, pmFocus, textblockRanges } from './pmFocus';

function mount(paragraphs: string[]): EditorView {
  const doc = liveSchema.node('doc', null, paragraphs.map((t, i) =>
    liveSchema.node('paragraph', { blockId: `b${i}` }, [liveSchema.text(t)])));
  const host = document.createElement('div');
  document.body.appendChild(host);
  return new EditorView(host, {
    state: EditorState.create({ doc, plugins: [focusDimPlugin()] }),
  });
}

function dimmedCount(view: EditorView): number {
  return view.dom.querySelectorAll('.edtr-dim').length;
}

/**
 * blockquote(paragraph('aaa'), paragraph('bbbb')), then a top-level
 * paragraph('ccc'). Every fixture above is FLAT — every top-level child of
 * `doc` already IS a textblock, so "innermost textblock" and "top-level
 * child" cannot be told apart by any of them: an implementation that dimmed
 * top-level children wholesale, never recursing into a container, would
 * pass all six of the tests above identically. This is the one fixture
 * where the two rules diverge (fix round 1, finding 2).
 */
function mountNested(): EditorView {
  const doc = liveSchema.node('doc', null, [
    liveSchema.node('blockquote', { blockId: 'q' }, [
      liveSchema.node('paragraph', { blockId: 'q-a' }, [liveSchema.text('aaa')]),
      liveSchema.node('paragraph', { blockId: 'q-b' }, [liveSchema.text('bbbb')]),
    ]),
    liveSchema.node('paragraph', { blockId: 'c' }, [liveSchema.text('ccc')]),
  ]);
  const host = document.createElement('div');
  document.body.appendChild(host);
  return new EditorView(host, {
    state: EditorState.create({ doc, plugins: [focusDimPlugin()] }),
  });
}

describe('textblockRanges', () => {
  it('reports one range per textblock', () => {
    const view = mount(['aaa', 'bbbb']);
    expect(textblockRanges(view.state.doc)).toEqual([
      { from: 1, to: 4 },
      { from: 6, to: 10 },
    ]);
    view.destroy();
  });

  it('recurses into a container, reporting its inner textblocks rather than one range for the container itself', () => {
    // blockquote nodeSize is 13 (paragraph 'aaa' = 5, paragraph 'bbbb' = 6,
    // plus the blockquote's own open/close tokens) — the trailing top-level
    // paragraph 'ccc' starts at 13, one past the blockquote entirely. If
    // this reported one range for the blockquote as a whole, it would be
    // { from: 1, to: 12 } and there would be only two entries, not three.
    const view = mountNested();
    expect(textblockRanges(view.state.doc)).toEqual([
      { from: 2, to: 5 },
      { from: 7, to: 11 },
      { from: 14, to: 17 },
    ]);
    view.destroy();
  });
});

describe('focus mode over a Live view', () => {
  it('dims nothing until it is switched on', () => {
    const view = mount(['one', 'two', 'three']);
    expect(dimmedCount(view)).toBe(0);
    view.destroy();
  });

  it('dims every block except the one holding the caret', () => {
    const view = mount(['one', 'two', 'three']);
    pmFocus(view).setFocusEnabled(true);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)));
    expect(dimmedCount(view)).toBe(2);
    view.destroy();
  });

  it('moves the lit block when the caret moves', () => {
    const view = mount(['one', 'two']);
    pmFocus(view).setFocusEnabled(true);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    const firstLit = view.dom.querySelectorAll('p:not(.edtr-dim)').length;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)));
    expect(firstLit).toBe(1);
    expect(view.dom.querySelectorAll('p:not(.edtr-dim)').length).toBe(1);
    expect(dimmedCount(view)).toBe(1);
    view.destroy();
  });

  it('stops dimming when switched off', () => {
    const view = mount(['one', 'two']);
    const surface = pmFocus(view);
    surface.setFocusEnabled(true);
    expect(dimmedCount(view)).toBeGreaterThan(0);
    surface.setFocusEnabled(false);
    expect(dimmedCount(view)).toBe(0);
    view.destroy();
  });

  it('NEVER changes the document, and its transactions carry no steps', () => {
    // The no-beautify guarantee for this feature. A decoration transaction
    // that carried a step would be visible to dirtyTracking and could reach a
    // serializer; one that carries only meta cannot.
    const view = mount(['one', 'two']);
    const before = view.state.doc;
    const stepCounts: number[] = [];
    const original = view.dispatch.bind(view);
    view.dispatch = (tr) => { stepCounts.push(tr.steps.length); original(tr); };
    const surface = pmFocus(view);
    surface.setFocusEnabled(true);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)));
    surface.setFocusEnabled(false);
    expect(stepCounts.every((n) => n === 0)).toBe(true);
    expect(view.state.doc.eq(before)).toBe(true);
    view.destroy();
  });

  it('dims only the innermost textblocks, never a container, when blocks are nested inside another block (a blockquote)', () => {
    // Acid test for "innermost textblock", per fix round 1 finding 2: every
    // other fixture in this file is flat, where "innermost" and "top-level
    // child" are indistinguishable. An HTML <section> holding paragraphs is
    // the real-world shape this guards; a blockquote is the nesting
    // container liveSchema actually offers.
    const view = mountNested();
    pmFocus(view).setFocusEnabled(true);
    // Caret inside the SECOND paragraph inside the blockquote ('bbbb', range [7,11]).
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8)));
    const quote = view.dom.querySelector('blockquote')!;
    expect(quote.classList.contains('edtr-dim')).toBe(false);
    const innerParas = quote.querySelectorAll('p');
    expect(innerParas.length).toBe(2);
    expect(innerParas[0].classList.contains('edtr-dim')).toBe(true); // 'aaa' — dimmed
    expect(innerParas[1].classList.contains('edtr-dim')).toBe(false); // 'bbbb' — lit, the caret's block
    expect(dimmedCount(view)).toBe(2); // 'aaa' inside the quote, and the top-level 'ccc'
    view.destroy();
  });

  it('memoises the decoration set: repeated updates that touch neither the document nor the active block do not re-walk it', () => {
    // `descendants` is what both `textblockRanges` and the decoration builder
    // use to walk the document — spying on the prototype method (rather than
    // on the module's own exports) catches both call sites regardless of how
    // pmFocus.ts happens to call them internally.
    const view = mount(['one', 'two', 'three']);
    pmFocus(view).setFocusEnabled(true);
    // Settle on a caret inside 'two' (range [6,9]) before measuring, so the
    // unavoidable first build — which always walks — isn't counted.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)));

    const spy = vi.spyOn(PMNode.prototype, 'descendants');
    // A bare no-op transaction, then two more selection moves that both still
    // land inside 'two' — none of these changes the document or moves the
    // caret to a different active block.
    view.dispatch(view.state.tr);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8)));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)));
    expect(spy).not.toHaveBeenCalled();

    // The cache is not simply stuck: moving to a genuinely different active
    // block (the top-level 'ccc' outside this fixture's blocks — use 'three'
    // here, range starting further on) still triggers exactly one fresh walk.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 12)));
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
    view.destroy();
  });
});
