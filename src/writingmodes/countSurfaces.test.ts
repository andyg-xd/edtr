// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState as CmState } from '@codemirror/state';
import { EditorView as CmView } from '@codemirror/view';
import { EditorState as PmState } from 'prosemirror-state';
import { EditorView as PmView } from 'prosemirror-view';
import { liveSchema } from '../views/liveSchema';
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
});
