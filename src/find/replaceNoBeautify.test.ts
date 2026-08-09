// @vitest-environment jsdom
// src/find/replaceNoBeautify.test.ts
//
// The load-bearing tests of the whole application: Replace must rewrite ONLY
// the bytes the user actually changed. Everything else Edtr does is
// convenience; this file is the guarantee.
//
// Both helpers mirror the REAL production path:
//   1. `toLive`/`toLiveHtml` build the Live doc from source (DocumentView's
//      `live`/`liveHtml` memos).
//   2. A real `EditorView` is mounted with the plugins write-back fidelity
//      actually depends on — `blockIdentityPlugin` + `dirtyTrackingPlugin`
//      + `findDecorationsPlugin` — the same ones `LiveView`/`HtmlLiveView`
//      install, though not the full list: `history()` and the input keymaps
//      are also mounted there and are irrelevant to write-back, so they're
//      omitted here.
//   3. `computeReplacements` + `pmSurface(view).applyEdits(...)` is the exact
//      pipeline `DocumentView.onReplace`/`onReplaceAll` call.
//   4. `writeBack`/`htmlWriteBack` is called with the SAME arguments
//      `DocumentView.flushToSource` passes: the current doc, the baseline
//      SOURCE STRING (not the post-edit one), the dirty id set, (flavor for
//      Markdown), and the baseline doc.
import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { liveSchema } from '../views/liveSchema';
import { htmlSchema } from '../views/htmlSchema';
import { dirtyTrackingPlugin, getDirtyBlockIds } from '../views/dirtyTracking';
import { blockIdentityPlugin } from '../views/blockIdentity';
import { toLive, writeBack, htmlWriteBack } from '../views/ViewSync';
import { toLiveHtml } from '../views/htmlModel';
import { detectFlavor } from '../doc/flavor';
import { pmSurface, findDecorationsPlugin } from './pmSurface';
import { computeReplacements } from './replaceText';
import { emptyQuery } from './findQuery';

/** What one replace-through-Live-view run produced, and how it got there. */
interface ReplaceResult {
  output: string;
  /** The dirty set `writeBack`/`htmlWriteBack` actually saw. Exposed so a
   *  no-op test can assert IT WAS ZERO (never reached the serializer) rather
   *  than that being an accident nobody checked. */
  dirty: Set<string>;
}

const MD_FIXTURE = [
  '# Title',
  '',
  'A paragraph with **bold** text and the word cat in it.',
  '',
  '- one',
  '- two with cat',
  '',
  '```',
  'code with cat is editable in live view too',
  '```',
  '',
].join('\n');

/**
 * Mounts the Markdown Live doc in a real `EditorView`, runs a replace through
 * the exact pipeline `DocumentView.onReplace`/`onReplaceAll` use, then
 * flushes through the exact call `DocumentView.flushToSource` makes to
 * `writeBack`.
 */
function replaceThroughLiveView(source: string, query: string, replacement: string): ReplaceResult {
  const result = toLive(source, null);
  if (!result.ok) throw new Error('fixture degraded — cannot exercise Live view');
  const baselineDoc = result.doc;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = new EditorView(host, {
    state: EditorState.create({
      doc: baselineDoc,
      schema: liveSchema,
      plugins: [blockIdentityPlugin(), dirtyTrackingPlugin(), findDecorationsPlugin()],
    }),
  });
  try {
    const surface = pmSurface(view);
    const edits = computeReplacements(
      surface.getSegments(),
      { ...emptyQuery, text: query },
      replacement,
      { multiline: surface.multiline },
    );
    surface.applyEdits(edits);
    const dirty = getDirtyBlockIds(view.state);
    const output = writeBack(view.state.doc, source, dirty, detectFlavor(source, 'markdown'), baselineDoc);
    return { output, dirty };
  } finally {
    view.destroy();
    host.remove();
  }
}

describe('replace is surgical (Markdown)', () => {
  it('changes ONLY the replaced bytes', () => {
    const { output } = replaceThroughLiveView(MD_FIXTURE, 'cat', 'dog');
    // Byte-for-byte: every untouched line, the blank lines between blocks, and
    // the trailing newline must survive identically.
    expect(output).toBe(MD_FIXTURE.split('cat').join('dog'));
  });

  it('replacing text with itself leaves the file byte-identical', () => {
    const { output, dirty } = replaceThroughLiveView(MD_FIXTURE, 'cat', 'cat');
    expect(output).toBe(MD_FIXTURE);
    // Pin the MECHANISM, since this test does not exercise the serializer at
    // all: `dirtyTrackingPlugin` is differs-from-baseline, not ever-touched
    // (dirtyTracking.test.ts's "un-marks a block when it is edited back to
    // its baseline content"), so a same-text replace produces an EMPTY dirty
    // set — `reconcile` byte-slices every block from the baseline and
    // `serializeBlock` never runs. That is still worth asserting (an
    // over-eager dirty tracker that marked a no-op edit dirty would be a
    // real regression), but it is not, on its own, a no-beautify proof — see
    // the round-trip test below for the one that actually forces the
    // serializer to run.
    expect(dirty.size).toBe(0);
  });

  it('preserves the trailing newline', () => {
    // Strictly implied by "changes ONLY the replaced bytes" above: if that
    // full-string equality holds, its trailing newline necessarily matches
    // too. Kept as documentation of intent, not as an independent proof.
    const { output } = replaceThroughLiveView(MD_FIXTURE, 'cat', 'dog');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('a two-pass round trip (cat→dog→cat) reproduces the original byte-for-byte', () => {
    // The no-op test above never reaches the serializer. This is the proof
    // that actually does: both passes have a genuinely non-empty dirty set,
    // so `serializeBlock` runs for real, twice, on different text — and the
    // bytes still have to land exactly back on the original. THIS is "must
    // not reflow, re-indent or re-wrap anything on its way through."
    const first = replaceThroughLiveView(MD_FIXTURE, 'cat', 'dog');
    expect(first.dirty.size).toBeGreaterThan(0);
    const second = replaceThroughLiveView(first.output, 'dog', 'cat');
    expect(second.dirty.size).toBeGreaterThan(0);
    expect(second.output).toBe(MD_FIXTURE);
  });
});

// Attributes (class, id, data-*), a <head><style> block, and a <script> block.
// All three survive byte-identical BY CONSTRUCTION, not by any serializer
// decision: <head>/<style>/doctype sit outside the body's document tree
// entirely (the reconciler's literal `prefix`), and <script> has no
// BLOCK_TAGS mapping so it degrades to a top-level read-only `verbatim` atom
// that `flattenBlocks`' SKIP_ATOMS excludes from ever producing a segment —
// Replace cannot reach it, so it is never in the dirty set, so `reconcile`
// byte-slices it from the baseline. That is a WEAKER guarantee than the
// edited paragraphs below (which really do go through the serializer) — see
// the round-trip test for the one that exercises those.
const HTML_FIXTURE =
  '<!doctype html>\n'
  + '<html lang="en">\n'
  + '<head>\n'
  + '<style>\n'
  + 'p.cat { color: red; }\n'
  + '</style>\n'
  + '</head>\n'
  + '<body class="page" id="root">\n'
  + '<p class="intro" data-id="1">A paragraph with <strong>bold</strong> text and the word cat in it.</p>\n'
  + '<p>a line with no target word here, left untouched</p>\n'
  + '<p class="tail">two with cat, once more</p>\n'
  + '<script>\n'
  + 'var cat = "this cat must stay untouched";\n'
  + '</script>\n'
  + '</body>\n'
  + '</html>\n';

/** Same shape as `replaceThroughLiveView`, for the HTML Live pipeline. */
function replaceThroughLiveViewHtml(source: string, query: string, replacement: string): ReplaceResult {
  const result = toLiveHtml(source, null);
  if (!result.ok) throw new Error('fixture degraded — cannot exercise Live view');
  const baselineDoc = result.doc;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = new EditorView(host, {
    state: EditorState.create({
      doc: baselineDoc,
      schema: htmlSchema,
      plugins: [blockIdentityPlugin(), dirtyTrackingPlugin(), findDecorationsPlugin()],
    }),
  });
  try {
    const surface = pmSurface(view);
    const edits = computeReplacements(
      surface.getSegments(),
      { ...emptyQuery, text: query },
      replacement,
      { multiline: surface.multiline },
    );
    surface.applyEdits(edits);
    const dirty = getDirtyBlockIds(view.state);
    const output = htmlWriteBack(view.state.doc, source, dirty, baselineDoc);
    return { output, dirty };
  } finally {
    view.destroy();
    host.remove();
  }
}

// The two editable occurrences of "cat" (inside the first and third <p>) turn
// into "dog"; the two occurrences sealed inside <style> and <script> — which
// Live view can never reach — do not.
const HTML_FIXTURE_CAT_TO_DOG =
  '<!doctype html>\n'
  + '<html lang="en">\n'
  + '<head>\n'
  + '<style>\n'
  + 'p.cat { color: red; }\n'
  + '</style>\n'
  + '</head>\n'
  + '<body class="page" id="root">\n'
  + '<p class="intro" data-id="1">A paragraph with <strong>bold</strong> text and the word dog in it.</p>\n'
  + '<p>a line with no target word here, left untouched</p>\n'
  + '<p class="tail">two with dog, once more</p>\n'
  + '<script>\n'
  + 'var cat = "this cat must stay untouched";\n'
  + '</script>\n'
  + '</body>\n'
  + '</html>\n';

describe('replace is surgical (HTML)', () => {
  it('changes ONLY the replaced bytes — <head>, <style>, <script>, doctype and attributes untouched', () => {
    const { output } = replaceThroughLiveViewHtml(HTML_FIXTURE, 'cat', 'dog');
    expect(output).toBe(HTML_FIXTURE_CAT_TO_DOG);
  });

  it('replacing text with itself leaves the file byte-identical', () => {
    const { output, dirty } = replaceThroughLiveViewHtml(HTML_FIXTURE, 'cat', 'cat');
    expect(output).toBe(HTML_FIXTURE);
    // Same mechanism-pin as the Markdown case above — this never reaches
    // `serializeHtmlBlock`; the round-trip test below is what does.
    expect(dirty.size).toBe(0);
  });

  it('preserves the trailing newline', () => {
    // Strictly implied by the full-equality assertion above; see the
    // Markdown case's comment.
    const { output } = replaceThroughLiveViewHtml(HTML_FIXTURE, 'cat', 'dog');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('a two-pass round trip (cat→dog→cat) reproduces the original byte-for-byte', () => {
    // Forces `serializeHtmlBlock` to run for real on both editable <p>
    // blocks, twice, on different text — and the bytes still have to land
    // exactly back on the original, including the class/data attributes and
    // the <strong> run inside the first paragraph.
    const first = replaceThroughLiveViewHtml(HTML_FIXTURE, 'cat', 'dog');
    expect(first.dirty.size).toBeGreaterThan(0);
    const second = replaceThroughLiveViewHtml(first.output, 'dog', 'cat');
    expect(second.dirty.size).toBeGreaterThan(0);
    expect(second.output).toBe(HTML_FIXTURE);
  });
});
