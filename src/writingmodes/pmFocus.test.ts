// src/writingmodes/pmFocus.test.ts
import { describe, it, expect } from 'vitest';
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

describe('textblockRanges', () => {
  it('reports one range per textblock', () => {
    const view = mount(['aaa', 'bbbb']);
    expect(textblockRanges(view.state.doc)).toEqual([
      { from: 1, to: 4 },
      { from: 6, to: 10 },
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
});
