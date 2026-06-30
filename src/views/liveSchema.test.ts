import { describe, it, expect } from 'vitest';
import { liveSchema } from './liveSchema';

describe('liveSchema', () => {
  it('builds a paragraph with source-range attrs and inline marks', () => {
    const p = liveSchema.node('paragraph', { srcFrom: 0, srcTo: 5, blockId: 'b0' }, [
      liveSchema.text('hi', [liveSchema.marks.strong.create()]),
    ]);
    expect(p.type.name).toBe('paragraph');
    expect(p.attrs.srcFrom).toBe(0);
    expect(p.attrs.blockId).toBe('b0');
    expect(p.firstChild!.marks[0].type.name).toBe('strong');
  });

  it('builds a heading carrying its level', () => {
    const h = liveSchema.node('heading', { level: 2, srcFrom: 0, srcTo: 4, blockId: 'b1' }, [
      liveSchema.text('Hi'),
    ]);
    expect(h.attrs.level).toBe(2);
  });

  it('builds a doc of blocks and validates content', () => {
    const doc = liveSchema.node('doc', null, [
      liveSchema.node('paragraph', { srcFrom: 0, srcTo: 1, blockId: 'b0' }, [liveSchema.text('a')]),
      liveSchema.node('horizontalRule', { srcFrom: 2, srcTo: 5, blockId: 'b1' }),
    ]);
    expect(doc.childCount).toBe(2);
    doc.check(); // throws if the doc violates the schema
  });

  it('builds a verbatim block holding raw markdown', () => {
    const v = liveSchema.node('verbatim', { raw: '| a | b |', srcFrom: 0, srcTo: 9, blockId: 'b0' });
    expect(v.attrs.raw).toBe('| a | b |');
    expect(v.isAtom).toBe(true);
  });
});
