// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { liveSchema } from '../views/liveSchema';
import { htmlSchema } from '../views/htmlSchema';
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

/**
 * Like `mount`, but the caller supplies the whole doc rather than a flat
 * string — for fixtures `mount`'s one-paragraph-of-plain-text shape can't
 * express (a mark on part of a run, an atom mid-block, ...).
 */
function mountDoc(doc: PMNode, extra: unknown[] = []): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
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
    const surface = pmSurface(mountDoc(doc));
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

  it('applies edits and keeps the marks from the match start', () => {
    const doc = s.node('doc', null, [
      s.node('paragraph', { blockId: 'b0' }, [
        s.text('a '), s.text('cat', [s.marks.strong.create()]),
      ]),
    ]);
    const view = mountDoc(doc);
    // "cat" occupies positions 3..6 and is entirely bold.
    const result = pmSurface(view).applyEdits([{ from: 3, to: 6, text: 'dog' }]);
    expect(view.state.doc.textBetween(0, view.state.doc.content.size)).toBe('a dog');
    const $at = view.state.doc.resolve(4);
    expect($at.marks().some((mk) => mk.type.name === 'strong')).toBe(true);
    expect(result.crossedFormatting).toBe(false);
  });

  it('reports a replacement that crossed a formatting boundary', () => {
    // "a cat" runs plain -> bold, so replacing across it takes the formatting
    // from the START of the match and the user must be told (D2).
    const doc = s.node('doc', null, [
      s.node('paragraph', { blockId: 'b0' }, [
        s.text('a '), s.text('cat', [s.marks.strong.create()]),
      ]),
    ]);
    const view = mountDoc(doc);
    const result = pmSurface(view).applyEdits([{ from: 1, to: 6, text: 'dog' }]);
    expect(result.crossedFormatting).toBe(true);
  });

  it('keeps a non-inclusive mark (link) when the match starts on the LAST character of its run', () => {
    // `link` is `inclusive: false` (liveSchema.ts) -- `ResolvedPos.marks()`
    // drops a non-inclusive mark whenever the resolved position's
    // `textOffset` is 0, which is exactly what happens when a match starts
    // on the LAST character of the marked run: resolving position 4 (just
    // past 'c') reads as "before ' rest'", even though position 3 -- the
    // character the match actually starts on -- IS linked. Marks must come
    // from the node containing that character (`nodeAt`), not from resolving
    // just past it.
    const doc = s.node('doc', null, [
      s.node('paragraph', { blockId: 'b0' }, [
        s.text('abc', [s.marks.link.create({ href: 'x' })]), s.text(' rest'),
      ]),
    ]);
    const view = mountDoc(doc);
    // "c" is the link run's last character, at position 3..4.
    pmSurface(view).applyEdits([{ from: 3, to: 4, text: 'x' }]);
    expect(view.state.doc.textBetween(0, view.state.doc.content.size)).toBe('abx rest');
    expect(view.state.doc.nodeAt(3)?.marks.some((mk) => mk.type.name === 'link')).toBe(true);
  });

  it('does not report a false crossing for a range wholly inside one non-inclusive run', () => {
    // Same fixture and edit as above: the range [3,4) never leaves the
    // linked run, so this must NOT raise D2's notice. The bug this guards
    // against compared the (wrongly filtered) marks at a RESOLVED position
    // against the (correct, unfiltered) marks on the run's own text node --
    // two different mark sets describing the exact same single run.
    const doc = s.node('doc', null, [
      s.node('paragraph', { blockId: 'b0' }, [
        s.text('abc', [s.marks.link.create({ href: 'x' })]), s.text(' rest'),
      ]),
    ]);
    const view = mountDoc(doc);
    const result = pmSurface(view).applyEdits([{ from: 3, to: 4, text: 'x' }]);
    expect(result.crossedFormatting).toBe(false);
  });

  it('removes an atom the match spanned and reports it, rather than refusing the edit (D6)', () => {
    // "ca" + image + "t" flattens to "cat" (flattenBlocks skips the image's
    // text but not its position, per the earlier "maps and reveals" test) --
    // so a match on "cat" spans the image without the image ever appearing
    // in the matched text. D6 (spec §K5): the replace still goes through,
    // but the caller must be told what vanished.
    const doc = s.node('doc', null, [
      s.node('paragraph', { blockId: 'b0' }, [
        s.text('ca'), s.node('image', { src: 'x.png' }), s.text('t'),
      ]),
    ]);
    const view = mountDoc(doc);
    const result = pmSurface(view).applyEdits([{ from: 1, to: 5, text: 'dog' }]);
    expect(view.state.doc.textBetween(0, view.state.doc.content.size)).toBe('dog');
    // An image, specifically — the split matters (Finding 2 of the final
    // review): only this bucket carries a survival claim the caller can make.
    expect(result.removedImages).toBe(1);
    expect(result.removedEmbedded).toBe(0);
  });

  it('removes embedded content (inlineVerbatim) the match spanned and reports it separately from images (D6)', () => {
    // inlineVerbatim is HTML Live only -- liveSchema has no such node; it is
    // what an <abbr>, an inline <svg>, and every other tag htmlModel.ts has no
    // mark for all flatten to. Finding 2 of the final review: this bucket
    // must NOT be counted alongside an image's `removedImages`, because only
    // an image's file survives the edit -- this raw HTML is simply gone.
    const doc = htmlSchema.node('doc', null, [
      htmlSchema.node('paragraph', { blockId: 'b0' }, [
        htmlSchema.text('ca'), htmlSchema.node('inlineVerbatim', { raw: '<abbr>x</abbr>' }), htmlSchema.text('t'),
      ]),
    ]);
    const view = mountDoc(doc);
    const result = pmSurface(view).applyEdits([{ from: 1, to: 5, text: 'dog' }]);
    expect(view.state.doc.textBetween(0, view.state.doc.content.size)).toBe('dog');
    expect(result.removedEmbedded).toBe(1);
    expect(result.removedImages).toBe(0);
  });

  it('inspectEdits reports the same atom span WITHOUT touching the document', () => {
    // Task 5 needs this figure BEFORE the user commits to Replace All, so it
    // must be answerable with no mutation at all.
    const doc = s.node('doc', null, [
      s.node('paragraph', { blockId: 'b0' }, [
        s.text('ca'), s.node('image', { src: 'x.png' }), s.text('t'),
      ]),
    ]);
    const view = mountDoc(doc);
    const before = view.state.doc;
    const result = pmSurface(view).inspectEdits([{ from: 1, to: 5, text: 'dog' }]);
    expect(result.atomSpans).toBe(1);
    expect(view.state.doc.eq(before)).toBe(true);
  });

  it('reports zero atoms for an edit that spans none', () => {
    const v = mount('cat');
    const surface = pmSurface(v);
    expect(surface.inspectEdits([{ from: 1, to: 4, text: 'dog' }]).atomSpans).toBe(0);
    const result = surface.applyEdits([{ from: 1, to: 4, text: 'dog' }]);
    expect(result.removedImages).toBe(0);
    expect(result.removedEmbedded).toBe(0);
  });

  it('applies several edits as one step, without invalidating later positions', () => {
    const v = mount('cat and cat');
    // Positions are ascending; applying front-to-back would shift the second.
    pmSurface(v).applyEdits([{ from: 1, to: 4, text: 'x' }, { from: 9, to: 12, text: 'y' }]);
    expect(v.state.doc.textBetween(0, v.state.doc.content.size)).toBe('x and y');
  });

  it('deletes rather than inserting an empty text node', () => {
    // schema.text('') throws; replacing with nothing is a legitimate action.
    const v = mount('cat');
    expect(() => pmSurface(v).applyEdits([{ from: 1, to: 4, text: '' }])).not.toThrow();
    expect(v.state.doc.textBetween(0, v.state.doc.content.size)).toBe('');
  });

  it('reports editability from the view', () => {
    expect(pmSurface(mount('x')).editable()).toBe(true);
  });

  it('ignores an edit that outlived the document instead of throwing', () => {
    // Same posture as reveal's test above: a stale edit computed against a
    // document that has since changed must be dropped, not thrown -- an
    // out-of-range `replaceWith`/`delete` throws a RangeError, and that
    // would come out of whatever handler Task 5 wires the Replace button to.
    const v = mount('short');
    const before = v.state.doc;
    expect(() => pmSurface(v).applyEdits([{ from: 100, to: 120, text: 'x' }])).not.toThrow();
    expect(v.state.doc.eq(before)).toBe(true);
  });

  it('dispatches nothing when every edit is out of bounds', () => {
    // The bounds guard above can filter every edit down to zero -- verifying
    // the resulting document is unchanged does not tell apart "dispatched an
    // empty-steps transaction" from "never dispatched at all", so this checks
    // the dispatch itself rather than just its (absent) effect.
    const v = mount('short');
    let dispatched = false;
    v.setProps({
      dispatchTransaction(tr) {
        dispatched = true;
        v!.updateState(v!.state.apply(tr));
      },
    });
    pmSurface(v).applyEdits([{ from: 100, to: 120, text: 'x' }]);
    expect(dispatched).toBe(false);
  });
});
