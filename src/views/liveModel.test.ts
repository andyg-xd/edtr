import { describe, it, expect } from 'vitest';
import { buildLiveDoc, mdastToLiveDoc } from './liveModel';

function doc(source: string) {
  const r = buildLiveDoc(source);
  if (!r.ok) throw new Error(`unexpected degrade: ${r.reason}`);
  return r.doc;
}

describe('buildLiveDoc — block structure', () => {
  it('maps a heading with its level and source range', () => {
    const d = doc('## Title\n');
    const h = d.child(0);
    expect(h.type.name).toBe('heading');
    expect(h.attrs.level).toBe(2);
    expect(h.attrs.srcFrom).toBe(0);
    expect(h.attrs.srcTo).toBe(8); // "## Title"
    expect(h.textContent).toBe('Title');
  });

  it('maps a paragraph', () => {
    const d = doc('Hello world\n');
    expect(d.child(0).type.name).toBe('paragraph');
    expect(d.child(0).textContent).toBe('Hello world');
  });

  it('maps a fenced code block with language and verbatim value', () => {
    const d = doc('```js\nconst x = 1;\n```\n');
    const cb = d.child(0);
    expect(cb.type.name).toBe('codeBlock');
    expect(cb.attrs.lang).toBe('js');
    expect(cb.textContent).toBe('const x = 1;');
  });

  it('maps a blockquote containing a paragraph', () => {
    const d = doc('> quoted\n');
    const bq = d.child(0);
    expect(bq.type.name).toBe('blockquote');
    expect(bq.child(0).type.name).toBe('paragraph');
  });

  it('maps a bullet list with items', () => {
    const d = doc('- one\n- two\n');
    const list = d.child(0);
    expect(list.type.name).toBe('bulletList');
    expect(list.childCount).toBe(2);
    expect(list.child(0).type.name).toBe('listItem');
  });

  it('maps an ordered list carrying its start', () => {
    const d = doc('3. a\n4. b\n');
    const list = d.child(0);
    expect(list.type.name).toBe('orderedList');
    expect(list.attrs.start).toBe(3);
  });

  it('maps a thematic break to horizontalRule', () => {
    const d = doc('---\n');
    expect(d.child(0).type.name).toBe('horizontalRule');
  });

  it('assigns a distinct blockId to each top-level block', () => {
    const d = doc('a\n\nb\n');
    expect(d.child(0).attrs.blockId).not.toBe(d.child(1).attrs.blockId);
  });
});

describe('mdastToLiveDoc — degradation', () => {
  it('degrades to Code-only when a top-level block has no position', () => {
    const root = {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }] /* no position */ }],
    };
    const r = mdastToLiveDoc(root, 'x\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/position|locate/i);
  });
});
