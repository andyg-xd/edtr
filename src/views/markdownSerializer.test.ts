import { describe, it, expect } from 'vitest';
import { liveSchema } from './liveSchema';
import { escapeInline, serializeInline } from './markdownSerializer';
import type { FlavorProfile } from '../doc/types';

const star: FlavorProfile = {
  bullet: '-', emphasis: '*', strong: '**', headingStyle: 'atx', fence: '`', orderedDelimiter: '.', gfm: true,
};
const underscore: FlavorProfile = { ...star, emphasis: '_', strong: '__' };

// Build a paragraph from inline children for testing serializeInline.
function para(...inline: ReturnType<typeof liveSchema.text>[] | any[]) {
  return liveSchema.node('paragraph', { srcFrom: 0, srcTo: 0, blockId: 'b0' }, inline);
}

describe('escapeInline', () => {
  it('escapes markdown-significant characters', () => {
    expect(escapeInline('a*b_c`d[e]')).toBe('a\\*b\\_c\\`d\\[e\\]');
  });
  it('leaves plain text untouched', () => {
    expect(escapeInline('hello world')).toBe('hello world');
  });
});

describe('serializeInline', () => {
  it('serializes plain text', () => {
    expect(serializeInline(para(liveSchema.text('hello')), star)).toBe('hello');
  });
  it('serializes strong + emphasis per flavor (star)', () => {
    const p = para(liveSchema.text('b', [liveSchema.marks.strong.create()]), liveSchema.text(' and '), liveSchema.text('i', [liveSchema.marks.em.create()]));
    expect(serializeInline(p, star)).toBe('**b** and *i*');
  });
  it('serializes strong + emphasis per flavor (underscore)', () => {
    const p = para(
      liveSchema.text('b', [liveSchema.marks.strong.create()]),
      liveSchema.text('i', [liveSchema.marks.em.create()]),
    );
    expect(serializeInline(p, underscore)).toBe('__b___i_');
  });
  it('serializes inline code without escaping its content', () => {
    const p = para(liveSchema.text('x*y', [liveSchema.marks.code.create()]));
    expect(serializeInline(p, star)).toBe('`x*y`');
  });
  it('serializes strikethrough', () => {
    const p = para(liveSchema.text('gone', [liveSchema.marks.strikethrough.create()]));
    expect(serializeInline(p, star)).toBe('~~gone~~');
  });
  it('serializes a link with title', () => {
    const p = para(liveSchema.text('t', [liveSchema.marks.link.create({ href: 'http://x.test', title: 'ti' })]));
    expect(serializeInline(p, star)).toBe('[t](http://x.test "ti")');
  });
  it('serializes an image', () => {
    const p = para(liveSchema.node('image', { src: 'pic.png', alt: 'alt', title: null }));
    expect(serializeInline(p, star)).toBe('![alt](pic.png)');
  });
  it('serializes a hard break as backslash-newline', () => {
    const p = para(liveSchema.text('a'), liveSchema.node('hardBreak'), liveSchema.text('b'));
    expect(serializeInline(p, star)).toBe('a\\\nb');
  });
  it('escapes text that would form spurious markdown', () => {
    const p = para(liveSchema.text('snake_case *not bold*'));
    expect(serializeInline(p, star)).toBe('snake\\_case \\*not bold\\*');
  });
  it('serializes a code span inside a link', () => {
    const p = para(liveSchema.text('code', [liveSchema.marks.code.create(), liveSchema.marks.link.create({ href: 'http://x.test', title: null })]));
    expect(serializeInline(p, star)).toBe('[`code`](http://x.test)');
  });
  it('serializes a link without a title', () => {
    const p = para(liveSchema.text('t', [liveSchema.marks.link.create({ href: 'http://x.test', title: null })]));
    expect(serializeInline(p, star)).toBe('[t](http://x.test)');
  });
  it('serializes an image with a title', () => {
    const p = para(liveSchema.node('image', { src: 'pic.png', alt: 'alt', title: 'the title' }));
    expect(serializeInline(p, star)).toBe('![alt](pic.png "the title")');
  });
});
