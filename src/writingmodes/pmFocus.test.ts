// src/writingmodes/pmFocus.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { liveSchema } from '../views/liveSchema';
import { toLiveHtml } from '../views/htmlModel';
import { activeBlock } from './activeBlock';
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

/**
 * The HTML schema (HTML Live) — closing the gap that let 6c-ii's focus-mode
 * defect ship (6c-ii-b Task 2, structural gap G1).
 *
 * Every test above this point uses `liveSchema`. Until this block existed, NO
 * test in `src/writingmodes/` touched `htmlSchema` at all, for any of the
 * three writing modes — so the design's load-bearing claim, that ONE driver
 * serves both Live views, was asserted for focus mode and never exercised on
 * the HTML side. That is the structural reason 1005 tests could not see a
 * defect the owner found in minutes.
 *
 * These drive a REAL `toLiveHtml` parse rather than hand-built nodes, so the
 * fixture has production shape: heading, paragraph nested in a container, a
 * list item, a table cell, a code block, a blockquote, and a horizontal rule
 * (an ATOM, not a textblock — the walk must step over it without counting it).
 *
 * Scope note, so these are not mistaken for a regression test for the defect
 * itself: 6c-ii's HTML Live focus bug was a COLOUR defect, not a DOM one. The
 * dim class does reach the right elements here and always did; what was wrong
 * was dimming to a fixed absolute colour over a palette Edtr does not own.
 * That is asserted in `HtmlLiveView`'s own stylesheet test (Task 4), which is
 * the test that fails before its fix. These prove the structure the fix rests
 * on, which nothing proved before.
 */
describe('focus mode under the HTML schema', () => {
  const SOURCE = `<html><body>
  <h1>Heading one</h1>
  <p>An ordinary paragraph.</p>
  <div><p>Nested in a container.</p></div>
  <ul><li><p>A list item.</p></li></ul>
  <table><tr><td>A table cell</td></tr></table>
  <pre><code>const x = 1;</code></pre>
  <blockquote><p>A quoted paragraph.</p></blockquote>
  <hr>
  <p>A trailing paragraph.</p>
</body></html>`;

  function htmlDoc(): PMNode {
    const res = toLiveHtml(SOURCE);
    if (!res.ok) throw new Error(`fixture failed to parse: ${res.reason}`);
    return res.doc;
  }

  function mountHtml(doc: PMNode): EditorView {
    const host = document.createElement('div');
    document.body.appendChild(host);
    return new EditorView(host, {
      state: EditorState.create({ doc, plugins: [focusDimPlugin()] }),
    });
  }

  it('finds the innermost textblock inside every container the HTML schema builds', () => {
    const doc = htmlDoc();
    const ranges = textblockRanges(doc);
    // heading, paragraph, div>p, li>p, td>p, codeBlock, blockquote>p, trailing p.
    // The <hr> is an atom and contributes nothing — if it were counted this
    // would be 9. The container nodes (div, ul, li, table, tr, td, blockquote)
    // must never be lightable units themselves.
    expect(ranges).toHaveLength(8);

    const owners = ranges.map((r) => doc.resolve(r.from).parent.type.name);
    expect(owners).toEqual([
      'heading', 'paragraph', 'paragraph', 'paragraph',
      'paragraph', 'codeBlock', 'paragraph', 'paragraph',
    ]);
    expect(owners).not.toContain('div');
    expect(owners).not.toContain('table');
    expect(owners).not.toContain('bulletList');
  });

  it('lights the caret\'s own block and dims every other one, in each container type', () => {
    const doc = htmlDoc();
    const ranges = textblockRanges(doc);

    // Walk the caret through EVERY textblock. A container type whose position
    // maths were wrong would return null here, and pmFocus dims everything
    // when `activeBlock` is null (pmFocus.ts:78-80) — which presents as the
    // caret's own block fading instead of lighting.
    for (const r of ranges) {
      const mid = Math.floor((r.from + r.to) / 2);
      const active = activeBlock(ranges, mid);
      expect(active, `no active block for caret at ${mid}`).not.toBeNull();
      expect(active!.from).toBe(r.from);

      const view = mountHtml(doc);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, mid)));
      pmFocus(view).setFocusEnabled(true);
      // 8 textblocks, one lit, so 7 dimmed.
      expect(dimmedCount(view), `wrong dim count with caret at ${mid}`).toBe(ranges.length - 1);
      view.destroy();
    }
  });

  it('dims nothing until it is switched on, exactly as under liveSchema', () => {
    const view = mountHtml(htmlDoc());
    expect(dimmedCount(view)).toBe(0);
    pmFocus(view).setFocusEnabled(true);
    expect(dimmedCount(view)).toBeGreaterThan(0);
    pmFocus(view).setFocusEnabled(false);
    expect(dimmedCount(view)).toBe(0);
    view.destroy();
  });

  it('carries no document change, so dirty tracking sees nothing (no-beautify)', () => {
    const view = mountHtml(htmlDoc());
    const before = view.state.doc;
    pmFocus(view).setFocusEnabled(true);
    pmFocus(view).setFocusEnabled(false);
    // Same node by IDENTITY, not merely equal: a re-created doc would defeat
    // the point even if it compared equal.
    expect(view.state.doc).toBe(before);
    view.destroy();
  });
});
