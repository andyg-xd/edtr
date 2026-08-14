// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState as CmState } from '@codemirror/state';
import { EditorView as CmView } from '@codemirror/view';
import { EditorState as PmState, TextSelection } from 'prosemirror-state';
import { EditorView as PmView } from 'prosemirror-view';
import { liveSchema } from '../views/liveSchema';
import { toLiveHtml } from '../views/htmlModel';
import { codeCounts, pmCounts } from './countSurfaces';

describe('codeCounts', () => {
  it('counts the RAW buffer, markup included (D2)', () => {
    const view = new CmView({ state: CmState.create({ doc: '# Hello **world**' }) });
    // "#", "Hello", "**world**" — Code view counts what is in front of you.
    expect(codeCounts(view).countableText()).toBe('# Hello **world**');
    view.destroy();
  });

  it('returns the selection when there is one, and empty when there is not', () => {
    const view = new CmView({ state: CmState.create({ doc: 'one two' }) });
    expect(codeCounts(view).selectedText()).toBe('');
    view.dispatch({ selection: { anchor: 0, head: 3 } });
    expect(codeCounts(view).selectedText()).toBe('one');
    view.destroy();
  });

  it('returns to empty once a selection is cleared back to a bare caret', () => {
    // Review finding: every prior test only ever went empty -> selected. A
    // surface that latched its first non-empty read and never re-checked
    // would still pass those. This drives the SAME surface instance both ways
    // -- ONE `codeCounts(view)` call, read twice -- matching how DocumentView
    // actually uses it (the surface is memoized once via useMemo and read
    // repeatedly by useWordCount's debounced timer, never rebuilt per read).
    const view = new CmView({ state: CmState.create({ doc: 'one two' }) });
    const s = codeCounts(view);
    view.dispatch({ selection: { anchor: 0, head: 3 } });
    expect(s.selectedText()).toBe('one');
    view.dispatch({ selection: { anchor: 3, head: 3 } });
    expect(s.selectedText()).toBe('');
    view.destroy();
  });
});

describe('pmCounts', () => {
  function mount(paragraphs: string[]): PmView {
    const doc = liveSchema.node('doc', null, paragraphs.map((t, i) =>
      liveSchema.node('paragraph', { blockId: `b${i}` }, [liveSchema.text(t)])));
    const host = document.createElement('div');
    document.body.appendChild(host);
    return new PmView(host, { state: PmState.create({ doc }) });
  }

  it('counts the rendered text, not the markup (D2)', () => {
    const view = mount(['Hello world']);
    expect(pmCounts(view).countableText()).toBe('Hello world');
    view.destroy();
  });

  it('SEPARATES blocks so words do not fuse across a paragraph boundary', () => {
    // Without a block separator this returns "endbegin" and the two words
    // become one. This is the assertion that pins the separator.
    const view = mount(['end', 'begin']);
    const text = pmCounts(view).countableText();
    expect(text).not.toBe('endbegin');
    expect(text.split(/\s+/).filter(Boolean)).toEqual(['end', 'begin']);
    view.destroy();
  });

  it('selectedText SEPARATES blocks too, when the selection spans more than one (D2, same hazard as countableText)', () => {
    // Review finding: countableText() pinned the separator, but selectedText()
    // -- a DIFFERENT call to the same textBetween -- had no test of its own,
    // and it is exactly as capable of regressing back to "endbegin" (fused)
    // independently of the other. Select from the start of the first
    // paragraph's text through the end of the second's.
    const view = mount(['end', 'begin']);
    const from = 1; // start of "end"'s text, inside the first paragraph
    const to = 11; // end of "begin"'s text, inside the second paragraph
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    const text = pmCounts(view).selectedText();
    expect(text).not.toBe('endbegin');
    expect(text).toBe('end\nbegin');
    view.destroy();
  });
});

/**
 * The HTML schema (HTML Live) — 6c-ii-b Task 2, structural gap G1.
 *
 * Every `pmCounts` test above uses `liveSchema`. The count's HTML-specific
 * behaviour was therefore never exercised: spec **D2** decides the count
 * reflects the editor in front of you, so a `<script>` body counts in Code
 * view (it is text in the buffer) and must NOT count in Live view (it is not
 * text on the page). That claim shipped with no test on the HTML side, and
 * matrix item 16 — the check that would have caught it by hand — went
 * unreported in the 6c-ii GUI pass.
 */
describe('pmCounts under the HTML schema', () => {
  function htmlView(source: string): PmView {
    const res = toLiveHtml(source);
    if (!res.ok) throw new Error(`fixture failed to parse: ${res.reason}`);
    const host = document.createElement('div');
    document.body.appendChild(host);
    return new PmView(host, { state: PmState.create({ doc: res.doc }) });
  }

  it('counts the rendered text, not the markup', () => {
    const view = htmlView('<html><body><p class="lead">one two three</p></body></html>');
    const text = pmCounts(view).countableText();
    expect(text).toContain('one two three');
    // The tag and its attributes are markup, not page text.
    expect(text).not.toContain('class');
    expect(text).not.toContain('lead');
    view.destroy();
  });

  it('does NOT count a <script> body in Live view (D2)', () => {
    const view = htmlView(
      '<html><body><p>visible words here</p><script>var hidden = "aaa bbb ccc";</script></body></html>',
    );
    const text = pmCounts(view).countableText();
    expect(text).toContain('visible words here');
    // The load-bearing half of D2: script source is not page text.
    expect(text).not.toContain('hidden');
    expect(text).not.toContain('aaa bbb ccc');
    view.destroy();
  });

  it('reads a selection and returns to empty when it clears, same as under liveSchema', () => {
    const view = htmlView('<html><body><p>alpha bravo</p></body></html>');
    const counts = pmCounts(view);
    expect(counts.selectedText()).toBe('');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
    expect(counts.selectedText()).toBe('alpha');
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 1)));
    expect(counts.selectedText()).toBe('');
    view.destroy();
  });
});
