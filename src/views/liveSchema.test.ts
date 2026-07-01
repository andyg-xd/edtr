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

describe('table schema', () => {
  const { table, tableRow, tableCell } = liveSchema.nodes;
  const cell = (text: string, attrs = {}) =>
    tableCell.create(attrs, text ? liveSchema.text(text) : undefined);

  it('a table > tableRow > tableCell doc is valid', () => {
    const t = table.create(null, tableRow.create(null, [cell('A', { header: true }), cell('B', { header: true })]));
    expect(() => t.check()).not.toThrow();
    expect(t.type.isBlock).toBe(true);
  });

  it('header cell renders <th>, body cell renders <td>', () => {
    expect((tableCell.create({ header: true }).type.spec.toDOM!(tableCell.create({ header: true })) as any)[0]).toBe('th');
    expect((tableCell.create({ header: false }).type.spec.toDOM!(tableCell.create({ header: false })) as any)[0]).toBe('td');
  });

  it('an aligned cell carries text-align in toDOM', () => {
    const c = tableCell.create({ align: 'center' });
    const dom = tableCell.spec.toDOM!(c) as any;
    expect(dom[1]).toEqual({ style: 'text-align:center' });
  });

  it('tableCell is isolating', () => {
    expect(tableCell.spec.isolating).toBe(true);
  });

  it('table.createAndFill() yields a valid minimal instance', () => {
    const t = table.createAndFill();
    expect(t).not.toBeNull();
    expect(() => t!.check()).not.toThrow();
  });
});
