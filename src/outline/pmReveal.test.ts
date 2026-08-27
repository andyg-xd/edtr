// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { liveSchema } from '../views/liveSchema';
import { htmlSchema } from '../views/htmlSchema';
import { revealSourceInPm } from './pmReveal';
import type { OutlineEntry } from './types';

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; });

function mount(doc: never): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  view = new EditorView(host, { state: EditorState.create({ doc }) });
  return view;
}

const entry = (over: Partial<OutlineEntry>): OutlineEntry => ({
  id: 'n0', level: 2, text: 'Section', srcFrom: 0, srcTo: 0,
  ordinalInBlock: 0, blockFrom: 0, blockTo: 0, ...over,
});

describe('revealSourceInPm — top-level headings (Markdown)', () => {
  it('selects the heading whose block range contains the entry', () => {
    const s = liveSchema;
    const doc = s.node('doc', null, [
      s.node('heading', { level: 1, blockId: 'b0', srcFrom: 0, srcTo: 7 }, [s.text('Title')]),
      s.node('paragraph', { blockId: 'b1', srcFrom: 9, srcTo: 13 }, [s.text('text')]),
      s.node('heading', { level: 2, blockId: 'b2', srcFrom: 15, srcTo: 25 }, [s.text('Section')]),
    ]);
    const v = mount(doc as never);
    revealSourceInPm(v, entry({ srcFrom: 15, srcTo: 25, blockFrom: 15, blockTo: 25 }));
    expect(v.state.doc.resolve(v.state.selection.from).parent.textContent).toBe('Section');
  });
});

describe('revealSourceInPm — headings nested in a container (HTML)', () => {
  // THE case from spec §4.2. The <section> is the only node with a source
  // range; the headings inside it have none. Resolution is by ordinal.
  // A LEADING paragraph is load-bearing, not decoration. Without it the
  // container is the document's first block, and a fallback to position 0
  // lands in the same place as a correct fallback to the container -- which
  // made the D10 test below pass even with the fallback deliberately broken.
  // Verified by breaking it: see the commit message.
  function sectionDoc() {
    const h = htmlSchema;
    return h.node('doc', null, [
      h.node('paragraph', { blockId: 'h0', srcFrom: 0, srcTo: 30 }, [h.text('before the section')]),
      h.node('container', { tag: 'section', blockId: 'h1', srcFrom: 40, srcTo: 120 }, [
        h.node('heading', { level: 2 }, [h.text('First')]),
        h.node('paragraph', {}, [h.text('body text')]),
        h.node('heading', { level: 3 }, [h.text('Second')]),
      ]),
    ]);
  }

  it('reaches the FIRST heading inside the container', () => {
    const v = mount(sectionDoc() as never);
    revealSourceInPm(v, entry({ ordinalInBlock: 0, blockFrom: 40, blockTo: 120, srcFrom: 45, srcTo: 60 }));
    expect(v.state.doc.resolve(v.state.selection.from).parent.textContent).toBe('First');
  });

  it('reaches the SECOND heading inside the same container', () => {
    const v = mount(sectionDoc() as never);
    revealSourceInPm(v, entry({ ordinalInBlock: 1, blockFrom: 40, blockTo: 120, srcFrom: 80, srcTo: 95 }));
    expect(v.state.doc.resolve(v.state.selection.from).parent.textContent).toBe('Second');
  });

  it('falls back to the container when the ordinal is not there (spec D10)', () => {
    const v = mount(sectionDoc() as never);
    expect(() =>
      revealSourceInPm(v, entry({ ordinalInBlock: 9, blockFrom: 40, blockTo: 120 })),
    ).not.toThrow();
    // Landed INSIDE the container -- not at the document start, and not in the
    // paragraph before it. `toBeGreaterThan(0)` was the original assertion and
    // it was vacuous: a broken fallback still satisfied it.
    const $at = v.state.doc.resolve(v.state.selection.from);
    expect($at.parent.textContent).toBe('First');
  });

  it('does nothing when no block matches, without throwing', () => {
    const v = mount(sectionDoc() as never);
    expect(() => revealSourceInPm(v, entry({ blockFrom: 9999, blockTo: 10000 }))).not.toThrow();
  });
});

describe('revealSourceInPm — a live-derived entry carries an exact anchor', () => {
  // A5's consequence (2026-08-26). Live-derived entries come from walking the
  // document itself, so they know exactly where the heading is and need
  // neither the block range nor the ordinal. Their source fields are ZERO, so
  // the old path could not resolve them at all — it would look for a block
  // containing offset 0 and land on the first block every time.
  it('goes straight to the heading, ignoring the zeroed source fields', () => {
    const s = htmlSchema;
    const doc = s.node('doc', null, [
      s.node('heading', { level: 1, blockId: 'b0', srcFrom: 0, srcTo: 20 }, [s.text('Title')]),
      s.node('container', { tag: 'section', blockId: 'b1', srcFrom: 22, srcTo: 60 }, [
        s.node('heading', { level: 2 }, [s.text('Inside')]),
        s.node('paragraph', {}, [s.text('x')]),
      ]),
    ]);
    const v = mount(doc as never);

    // Exactly what buildLiveOutline produces for the nested heading.
    let target = -1;
    v.state.doc.descendants((n, pos) => {
      if (n.type.name === 'heading' && n.textContent === 'Inside') target = pos;
      return true;
    });
    expect(target).toBeGreaterThan(0);

    revealSourceInPm(v, entry({ text: 'Inside', pmPos: target }));
    expect(v.state.doc.resolve(v.state.selection.from).parent.textContent).toBe('Inside');
  });

  it('still resolves a source-derived entry by block and ordinal', () => {
    // The old path must be untouched: Code view and an unedited Live view both
    // still produce entries with no pmPos.
    const s = htmlSchema;
    const doc = s.node('doc', null, [
      s.node('paragraph', { blockId: 'b0', srcFrom: 0, srcTo: 5 }, [s.text('lead')]),
      s.node('container', { tag: 'section', blockId: 'b1', srcFrom: 10, srcTo: 60 }, [
        s.node('heading', { level: 2 }, [s.text('Inside')]),
      ]),
    ]);
    const v = mount(doc as never);
    revealSourceInPm(v, entry({ text: 'Inside', srcFrom: 20, blockFrom: 10, blockTo: 60, ordinalInBlock: 0 }));
    expect(v.state.doc.resolve(v.state.selection.from).parent.textContent).toBe('Inside');
  });
});
