// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { liveSchema } from '../views/liveSchema';
import { htmlSchema } from '../views/htmlSchema';
import { buildLiveOutline } from './liveOutline';
import { buildOutline } from './outlineModel';

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; });

function mount(doc: never): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  view = new EditorView(host, { state: EditorState.create({ doc }) });
  return view;
}

describe('buildLiveOutline — headings straight off the live document', () => {
  it('reads top-level Markdown headings with their levels', () => {
    const s = liveSchema;
    const v = mount(s.node('doc', null, [
      s.node('heading', { level: 1 }, [s.text('Title')]),
      s.node('paragraph', {}, [s.text('body')]),
      s.node('heading', { level: 2 }, [s.text('Section')]),
    ]) as never);
    expect(buildLiveOutline(v).map((e) => [e.level, e.text])).toEqual([[1, 'Title'], [2, 'Section']]);
  });

  it('finds headings NESTED inside a container, which is the whole point', () => {
    // A source-derived outline reaches these through a block range plus an
    // ordinal, because nested nodes carry no source range (spec §4.2). Walking
    // the live document reaches them directly.
    const s = htmlSchema;
    const v = mount(s.node('doc', null, [
      s.node('heading', { level: 1 }, [s.text('Title')]),
      s.node('container', { tag: 'section' }, [
        s.node('heading', { level: 2 }, [s.text('Inside')]),
        s.node('paragraph', {}, [s.text('x')]),
      ]),
    ]) as never);
    expect(buildLiveOutline(v).map((e) => e.text)).toEqual(['Title', 'Inside']);
  });

  it('carries a PM position that resolves to the heading itself', () => {
    const s = htmlSchema;
    const v = mount(s.node('doc', null, [
      s.node('heading', { level: 1 }, [s.text('Title')]),
      s.node('container', { tag: 'section' }, [s.node('heading', { level: 2 }, [s.text('Inside')])]),
    ]) as never);
    const inside = buildLiveOutline(v)[1];
    expect(inside.pmPos).toBeTypeOf('number');
    expect(v.state.doc.nodeAt(inside.pmPos!)?.textContent).toBe('Inside');
  });

  it('drops markup and returns plain text', () => {
    const s = liveSchema;
    const v = mount(s.node('doc', null, [
      s.node('heading', { level: 1 }, [s.text('Plain '), s.text('bold', [s.mark('strong')])]),
    ]) as never);
    expect(buildLiveOutline(v)[0].text).toBe('Plain bold');
  });

  it('reflects a heading added AFTER projection, with no flush anywhere', () => {
    // This is A5 itself. The source-derived path cannot do this: `session.text`
    // only changes on `flushToSource`, so a heading typed in Live view is
    // invisible to it until a save or a view toggle forces one.
    const s = liveSchema;
    const v = mount(s.node('doc', null, [
      s.node('heading', { level: 1 }, [s.text('Title')]),
      s.node('paragraph', {}, [s.text('body')]),
    ]) as never);
    expect(buildLiveOutline(v).map((e) => e.text)).toEqual(['Title']);

    // The same shape a ribbon command or typing produces: a transaction.
    v.dispatch(v.state.tr.replaceWith(
      v.state.doc.content.size, v.state.doc.content.size,
      s.node('heading', { level: 2 }, [s.text('Typed Later')]),
    ));

    expect(buildLiveOutline(v).map((e) => e.text)).toEqual(['Title', 'Typed Later']);
  });

  it('returns nothing for a document with no headings', () => {
    const s = liveSchema;
    const v = mount(s.node('doc', null, [s.node('paragraph', {}, [s.text('just text')])]) as never);
    expect(buildLiveOutline(v)).toEqual([]);
  });

  it('gives every entry a unique id, so the panel can mark exactly one', () => {
    const s = liveSchema;
    const v = mount(s.node('doc', null, [
      s.node('heading', { level: 1 }, [s.text('Same')]),
      s.node('heading', { level: 1 }, [s.text('Same')]),
    ]) as never);
    const ids = buildLiveOutline(v).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/**
 * D-1's condition, and not optional: spec D2 promised ONE list identical in
 * every view. Deriving it two ways keeps that promise only if the two ways
 * agree, so this is the test that holds the weakened spec to its word.
 */
describe('the two derivations agree on an unedited document', () => {
  it('agrees for Markdown', async () => {
    const src = '# Title\n\nbody text\n\n## Section\n\nmore\n\n### Deeper\n';
    const { toLive } = await import('../views/ViewSync');
    const r = toLive(src, null);
    if (!r.ok) throw new Error('fixture failed to project: ' + r.reason);
    const v = mount(r.doc as never);
    expect(buildLiveOutline(v).map((e) => [e.level, e.text]))
      .toEqual(buildOutline(src, 'markdown').map((e) => [e.level, e.text]));
  });

  it('agrees for HTML, including a heading inside a container', async () => {
    const src = '<!doctype html>\n<html><body><h1>Title</h1><section><h2>Inside</h2><p>x</p></section></body></html>';
    const { toLiveHtml } = await import('../views/htmlModel');
    const r = toLiveHtml(src, null);
    if (!r.ok) throw new Error('fixture failed to project: ' + r.reason);
    const v = mount(r.doc as never);
    expect(buildLiveOutline(v).map((e) => [e.level, e.text]))
      .toEqual(buildOutline(src, 'html').map((e) => [e.level, e.text]));
  });
});
