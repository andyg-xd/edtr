// @vitest-environment jsdom
// src/find/replaceNoBeautify.test.ts
//
// The load-bearing tests of the whole application: Replace must rewrite ONLY
// the bytes the user actually changed. Everything else Edtr does is
// convenience; this file is the guarantee.
//
// Both helpers mirror the REAL production path bit-for-bit:
//   1. `toLive`/`toLiveHtml` build the Live doc from source (DocumentView's
//      `live`/`liveHtml` memos).
//   2. A real `EditorView` is mounted with the SAME plugin set `LiveView` /
//      `HtmlLiveView` install (`blockIdentityPlugin` + `dirtyTrackingPlugin`
//      + `findDecorationsPlugin`) — dirty tracking has to be live for
//      `writeBack` to know what changed.
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

const MD_FIXTURE = [
  '# Title',
  '',
  'A paragraph with **bold** text and the word cat in it.',
  '',
  '- one',
  '- two with cat',
  '',
  '```',
  'code with cat stays untouched in live view',
  '```',
  '',
].join('\n');

/**
 * Mounts the Markdown Live doc in a real `EditorView` (same plugin list
 * `LiveView` installs: block identity + dirty tracking + find decorations),
 * runs a replace through the exact pipeline `DocumentView.onReplace` /
 * `onReplaceAll` use, then flushes through the exact call
 * `DocumentView.flushToSource` makes to `writeBack`.
 */
function replaceThroughLiveView(source: string, query: string, replacement: string): string {
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
    return writeBack(view.state.doc, source, dirty, detectFlavor(source, 'markdown'), baselineDoc);
  } finally {
    view.destroy();
    host.remove();
  }
}

describe('replace is surgical (Markdown)', () => {
  it('changes ONLY the replaced bytes', () => {
    const after = replaceThroughLiveView(MD_FIXTURE, 'cat', 'dog');
    // Byte-for-byte: every untouched line, the blank lines between blocks, and
    // the trailing newline must survive identically.
    expect(after).toBe(MD_FIXTURE.split('cat').join('dog'));
  });

  it('replacing text with itself leaves the file byte-identical', () => {
    // The strongest no-op statement available: a replace that changes nothing
    // must not reflow, re-indent or re-wrap anything on its way through.
    expect(replaceThroughLiveView(MD_FIXTURE, 'cat', 'cat')).toBe(MD_FIXTURE);
  });

  it('preserves the trailing newline', () => {
    expect(replaceThroughLiveView(MD_FIXTURE, 'cat', 'dog').endsWith('\n')).toBe(true);
  });
});

// Attributes (class, id, data-*), a <head><style> block, and a <script> block
// — all three must survive byte-identical, since none of them is reachable
// through Live view's editable text at all (head content sits outside the
// document tree entirely; <script> has no BLOCK_TAGS mapping and degrades to
// a read-only verbatim atom — see flattenBlocks' SKIP_ATOMS).
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
function replaceThroughLiveViewHtml(source: string, query: string, replacement: string): string {
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
    return htmlWriteBack(view.state.doc, source, dirty, baselineDoc);
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
    const after = replaceThroughLiveViewHtml(HTML_FIXTURE, 'cat', 'dog');
    expect(after).toBe(HTML_FIXTURE_CAT_TO_DOG);
  });

  it('replacing text with itself leaves the file byte-identical', () => {
    expect(replaceThroughLiveViewHtml(HTML_FIXTURE, 'cat', 'cat')).toBe(HTML_FIXTURE);
  });

  it('preserves the trailing newline', () => {
    expect(replaceThroughLiveViewHtml(HTML_FIXTURE, 'cat', 'dog').endsWith('\n')).toBe(true);
  });
});
