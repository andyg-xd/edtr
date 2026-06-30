import { describe, it, expect } from 'vitest';
import { liveSchema } from './liveSchema';
import { escapeInline, serializeInline, serializeBlock } from './markdownSerializer';
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

function tl(type: string, attrs: Record<string, unknown>, content?: any[]) {
  return liveSchema.node(type, { srcFrom: 0, srcTo: 0, blockId: 'b0', ...attrs }, content);
}

describe('serializeBlock', () => {
  it('paragraph', () => {
    expect(serializeBlock(tl('paragraph', {}, [liveSchema.text('hi')]), star)).toBe('hi');
  });
  it('atx heading', () => {
    expect(serializeBlock(tl('heading', { level: 2 }, [liveSchema.text('Title')]), star)).toBe('## Title');
  });
  it('setext heading per flavor', () => {
    const setext: FlavorProfile = { ...star, headingStyle: 'setext' };
    expect(serializeBlock(tl('heading', { level: 1 }, [liveSchema.text('Title')]), setext)).toBe('Title\n=====');
  });
  it('fenced code block with language, content not escaped', () => {
    const cb = tl('codeBlock', { lang: 'js' }, [liveSchema.text('const x = 1; // *no escape*')]);
    expect(serializeBlock(cb, star)).toBe('```js\nconst x = 1; // *no escape*\n```');
  });
  it('thematic break', () => {
    expect(serializeBlock(tl('horizontalRule', {}), star)).toBe('---');
  });
  it('blockquote prefixes each line', () => {
    const bq = tl('blockquote', {}, [
      liveSchema.node('paragraph', {}, [liveSchema.text('line one')]),
    ]);
    expect(serializeBlock(bq, star)).toBe('> line one');
  });
  it('bullet list with flavor bullet', () => {
    const list = tl('bulletList', {}, [
      liveSchema.node('listItem', { checked: null }, [liveSchema.node('paragraph', {}, [liveSchema.text('a')])]),
      liveSchema.node('listItem', { checked: null }, [liveSchema.node('paragraph', {}, [liveSchema.text('b')])]),
    ]);
    expect(serializeBlock(list, star)).toBe('- a\n- b');
  });
  it('ordered list with flavor delimiter + start', () => {
    const list = tl('orderedList', { start: 3 }, [
      liveSchema.node('listItem', { checked: null }, [liveSchema.node('paragraph', {}, [liveSchema.text('a')])]),
      liveSchema.node('listItem', { checked: null }, [liveSchema.node('paragraph', {}, [liveSchema.text('b')])]),
    ]);
    expect(serializeBlock(list, star)).toBe('3. a\n4. b');
  });
  it('task list items', () => {
    const list = tl('bulletList', {}, [
      liveSchema.node('listItem', { checked: true }, [liveSchema.node('paragraph', {}, [liveSchema.text('done')])]),
      liveSchema.node('listItem', { checked: false }, [liveSchema.node('paragraph', {}, [liveSchema.text('todo')])]),
    ]);
    expect(serializeBlock(list, star)).toBe('- [x] done\n- [ ] todo');
  });
  it('verbatim block emits its stored raw unchanged', () => {
    const v = liveSchema.node('verbatim', { raw: '| a | b |\n| - | - |', srcFrom: 0, srcTo: 0, blockId: 'b0' });
    expect(serializeBlock(v, star)).toBe('| a | b |\n| - | - |');
  });
});
