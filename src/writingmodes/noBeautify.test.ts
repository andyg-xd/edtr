// @vitest-environment jsdom
//
// The no-beautify proof for all three writing-mode features (focus dimming,
// typewriter scroll, word/character count). None of them may mark a block
// dirty or reach the real per-block serializer — they are view-only.
//
// `toSource`'s actual contract (ViewSync.ts:21-35) calls whatever
// `serializeBlock` callback it is given ONCE PER TOP-LEVEL BLOCK, regardless
// of dirty state — the callback itself decides real work vs. leave-alone by
// returning non-null or null, exactly as `serializeDirty` (ViewSync.ts:41-50)
// does in production. A raw spy that unconditionally throws, passed straight
// through as that callback, is not a probe of "did writing-mode features
// dirty anything" — it throws on the FIRST block of ANY document, dirty or
// not. That shape was tried while writing this test and confirmed broken by
// running it: `toSource` reached the throwing spy immediately, with the
// three features never having touched a single block. So the negative proof
// here puts a gate — matching `serializeDirty`'s own shape — in front of the
// spy: the gate is cheap and always runs (that's the real contract), and it
// is what tells a clean block from a dirty one before letting the expensive,
// real serializer anywhere near it.
//
// The pair below follows the same discipline as 6c-i-b's corrected no-op
// test: the FIRST test alone proves nothing (a probe that touches nothing
// could pass by doing nothing at all — that is exactly how 6c-i-b's no-op
// test went vacuous, reassembling the file from its own byte slices without
// ever reaching a serializer). The SECOND test proves the harness would have
// caught a real regression, by causing one.
import { describe, it, expect, vi } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { toLive, toSource, htmlWriteBack } from '../views/ViewSync';
import { toLiveHtml } from '../views/htmlModel';
import { dirtyTrackingPlugin, getDirtyBlockIds } from '../views/dirtyTracking';
import { focusDimPlugin, pmFocus } from './pmFocus';
import { pmTypewriter } from './pmTypewriter';
import { pmCounts } from './countSurfaces';
import { countText } from './countText';
import { HOLD_RATIO } from './constants';

const SOURCE = [
  '# Title',
  '',
  'A  paragraph   with  deliberately   odd   spacing.',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  'Trailing paragraph.',
  '',
].join('\n');

describe('writing modes never touch the file', () => {
  function mount() {
    // toLive's second parameter resolves image paths through Tauri's
    // convertFileSrc, which throws outside a Tauri runtime — null keeps this
    // test running under plain vitest/jsdom.
    const result = toLive(SOURCE, null);
    if (!result.ok) throw new Error('fixture failed to project');
    const host = document.createElement('div');
    host.className = 'live-view';
    document.body.appendChild(host);
    const view = new EditorView(host, {
      state: EditorState.create({
        doc: result.doc,
        // dirtyTrackingPlugin mirrors how DocumentView actually tracks which
        // blocks changed; focusDimPlugin is what focus mode installs.
        plugins: [focusDimPlugin(), dirtyTrackingPlugin()],
      }),
    });
    return { view, host };
  }

  /**
   * The same gate `serializeDirty` applies in production (ViewSync.ts:41-50):
   * consult the dirty set first, and only hand the block to the real,
   * work-doing serializer when it is actually dirty. Everything else is left
   * alone (returns null), which `toSource` treats as "emit verbatim".
   */
  function gatedOn(dirty: Set<string>, real: (block: PMNode) => string) {
    return (block: PMNode): string | null => {
      const id = block.attrs.blockId as string;
      if (!dirty.has(id)) return null;
      return real(block);
    };
  }

  it('leaves the source byte-identical after using all three features, and never reaches a real serializer', () => {
    const { view, host } = mount();
    const realSerializer = vi.fn(() => {
      throw new Error('a serializer must not run for a view-only feature');
    });

    // jsdom has no layout, so coordsAtPos (which needs a real getClientRects)
    // has to be stubbed — the same thing pmTypewriter.test.ts does. This is
    // the plumbing under holdCaret; the real scroll itself is GUI-verified.
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 0, bottom: 10, left: 0, right: 0 });

    pmFocus(view).setFocusEnabled(true);
    pmTypewriter(view, () => {}).holdCaret(HOLD_RATIO);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 12)));
    const counts = countText(pmCounts(view).countableText());

    // The count ran, so the pipeline was genuinely exercised rather than
    // skipped — without this the byte assertion below is satisfiable by doing
    // nothing at all, which is exactly how 6c-i-b's no-op test went vacuous.
    expect(counts.words).toBeGreaterThan(0);

    const dirty = getDirtyBlockIds(view.state);
    expect(dirty.size).toBe(0); // none of the above marked a single block dirty

    const out = toSource(view.state.doc, SOURCE, gatedOn(dirty, realSerializer));
    expect(realSerializer).not.toHaveBeenCalled();
    expect(out).toBe(SOURCE);

    view.destroy(); host.remove();
  });

  it('the real serializer WOULD fire on a real edit (proves the gate above is not vacuous)', () => {
    const { view, host } = mount();
    const realSerializer = vi.fn(() => 'anything');

    // A genuine text edit marks its block dirty — dirtyTrackingPlugin only
    // triggers on tr.docChanged, unlike every transaction the three features
    // above produce (focus mode carries meta only; typewriter never
    // dispatches at all; a selection change carries no steps either). If this
    // assertion fails, the previous test's "never called" proves nothing
    // about writing modes specifically — it would be just as satisfied by a
    // gate that never lets anything through.
    view.dispatch(view.state.tr.insertText('x', 3));
    const dirty = getDirtyBlockIds(view.state);
    expect(dirty.size).toBeGreaterThan(0);

    toSource(view.state.doc, SOURCE, gatedOn(dirty, realSerializer));
    expect(realSerializer).toHaveBeenCalled();

    view.destroy(); host.remove();
  });
});

/**
 * The same guarantee, under the HTML schema (6c-ii-b Task 10).
 *
 * Every assertion above runs on `liveSchema`. Until this sub-phase, NOTHING in
 * `src/writingmodes/` touched `htmlSchema` at all — which is the structural
 * reason focus mode shipped visibly broken in HTML Live and the suite saw
 * nothing. The no-beautify guarantee had exactly the same hole: it was proven
 * for one of the two Live surfaces and assumed for the other.
 *
 * This drives the REAL HTML pipeline (`toLiveHtml` → `htmlWriteBack`), because
 * that is the path a write actually takes, and asserts the file comes back
 * byte-identical after all of this sub-phase's features have been exercised on
 * it.
 */
describe('writing modes never touch an HTML file either', () => {
  const HTML_SOURCE = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <style>.lead{color:#41576b}   .odd  {  margin : 0  }</style>',
    '</head>',
    '<body>',
    '  <h1 class="lead">A   heading   with   odd   spacing</h1>',
    '  <div class="wrap"><p class="odd">Nested paragraph.</p></div>',
    '  <table><tr><td>cell</td></tr></table>',
    '  <p>Trailing.</p>',
    '</body>',
    '</html>',
    '',
  ].join('\n');

  function mountHtml() {
    const result = toLiveHtml(HTML_SOURCE);
    if (!result.ok) throw new Error(`fixture failed to project: ${result.reason}`);
    const host = document.createElement('div');
    host.className = 'html-live-view';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const mountPoint = document.createElement('div');
    shadow.appendChild(mountPoint);
    const view = new EditorView(mountPoint, {
      state: EditorState.create({
        doc: result.doc,
        plugins: [focusDimPlugin(), dirtyTrackingPlugin()],
      }),
    });
    return { view, host };
  }

  it('leaves an HTML file byte-identical after all of this sub-phase’s features', () => {
    const { view, host } = mountHtml();
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 0, bottom: 10, left: 0, right: 0 });

    // Focus mode (Task 4's relative dim is pure CSS, but the DECORATION path is
    // what could carry a transaction).
    pmFocus(view).setFocusEnabled(true);

    // Typewriter, including the 6c-ii-b guards: a suppressed hold must not
    // dispatch either, and neither must one that goes through.
    const tw = pmTypewriter(view, () => {});
    window.dispatchEvent(new Event('pointerdown'));
    tw.holdCaret(HOLD_RATIO);       // suppressed by the drag guard
    window.dispatchEvent(new Event('pointerup'));
    tw.holdCaret(HOLD_RATIO);       // allowed
    tw.setEndPadding(true);
    tw.setEndPadding(false);

    // Selection movement + the count, including the selection-scoped read that
    // Task 8 added.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 9)));
    const surface = pmCounts(view);
    const selCounts = countText(surface.selectedText());
    const docCounts = countText(surface.countableText());

    // Both reads did real work, so the byte assertion below cannot be satisfied
    // by a pipeline that quietly did nothing.
    expect(selCounts.characters).toBeGreaterThan(0);
    expect(docCounts.words).toBeGreaterThan(0);

    const dirty = getDirtyBlockIds(view.state);
    expect(dirty.size, 'no writing-mode action may mark a block dirty').toBe(0);

    const out = htmlWriteBack(view.state.doc, HTML_SOURCE, dirty);
    expect(out).toBe(HTML_SOURCE);

    view.destroy(); host.remove();
  });

  it('a REAL edit does change the HTML (proves the assertion above is not vacuous)', () => {
    // Without this, `htmlWriteBack` returning its baseline for any reason at
    // all — including being broken — would satisfy the test above. The same
    // vacuity trap 6c-i-b's no-op test fell into.
    const { view, host } = mountHtml();
    const from = view.state.doc.resolve(1).start();
    view.dispatch(view.state.tr.insertText('EDITED', from));

    const dirty = getDirtyBlockIds(view.state);
    expect(dirty.size, 'a real edit must mark a block dirty').toBeGreaterThan(0);

    const out = htmlWriteBack(view.state.doc, HTML_SOURCE, dirty);
    expect(out).not.toBe(HTML_SOURCE);
    expect(out).toContain('EDITED');
    // And everything it did NOT touch is still there verbatim — including the
    // <style> block's odd spacing, which no serializer should have tidied.
    expect(out).toContain('.lead{color:#41576b}   .odd  {  margin : 0  }');
    expect(out).toContain('<!doctype html>');

    view.destroy(); host.remove();
  });
});
