import { describe, it, expect } from 'vitest';
import { liveSchema } from './liveSchema';
import { escapeInline, serializeInline, serializeBlock } from './markdownSerializer';
import type { FlavorProfile } from '../doc/types';
import { parseMarkdownAst } from '../doc/parse';

const star: FlavorProfile = {
  bullet: '-', emphasis: '*', strong: '**', headingStyle: 'atx', fence: '`', orderedDelimiter: '.', gfm: true,
};
const underscore: FlavorProfile = { ...star, emphasis: '_', strong: '__' };

// Build a paragraph from inline children for testing serializeInline.
function para(...inline: ReturnType<typeof liveSchema.text>[] | any[]) {
  return liveSchema.node('paragraph', { srcFrom: 0, srcTo: 0, blockId: 'b0' }, inline);
}

// helper: concat all literal text from an mdast tree
function mdastText(node: any): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  return (node.children ?? []).map(mdastText).join('');
}
function hasInlineMarkup(node: any): boolean {
  const marks = ['emphasis', 'strong', 'delete', 'link', 'linkReference', 'inlineCode', 'image', 'html'];
  if (marks.includes(node.type)) return true;
  return (node.children ?? []).some(hasInlineMarkup);
}

describe('escapeInline', () => {
  it('escapes always-significant chars but leaves intraword _ and bare < alone', () => {
    expect(escapeInline('a*b_c`d[e]')).toBe('a\\*b_c\\`d\\[e]');
  });
  it('leaves plain text untouched', () => {
    expect(escapeInline('hello world')).toBe('hello world');
  });

  // The contract: escapeInline(S) must re-parse to the literal text S with no inline markup.
  const corpus: Array<[string, string]> = [
    ['snake_case', 'snake_case'],
    ['a_b_c', 'a_b_c'],
    ['_lead', '\\_lead'],
    ['trail_', 'trail\\_'],
    ['array[0]', 'array\\[0]'],
    ['2 * 3', '2 \\* 3'],
    ['a < b', 'a < b'],
    ['<3', '<3'],
    ['<not a tag', '\\<not a tag'],
    ['C++ & D', 'C++ & D'],
    ['~~not strike~~', '\\~\\~not strike\\~\\~'],
    ['~single~', '\\~single\\~'],
    ['use `code` here', 'use \\`code\\` here'],
  ];
  it.each(corpus)('escapes %j to %j (minimal)', (input, expected) => {
    expect(escapeInline(input)).toBe(expected);
  });
  it.each(corpus)('round-trips %j through the real parser', (input) => {
    const ast = parseMarkdownAst(escapeInline(input));
    expect(mdastText(ast)).toBe(input);
    expect(hasInlineMarkup(ast)).toBe(false);
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
    expect(serializeInline(p, star)).toBe('snake_case \\*not bold\\*');
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
  it('blockquote with two paragraphs prefixes a bare > on the blank line', () => {
    const bq = tl('blockquote', {}, [
      liveSchema.node('paragraph', {}, [liveSchema.text('line one')]),
      liveSchema.node('paragraph', {}, [liveSchema.text('line two')]),
    ]);
    expect(serializeBlock(bq, star)).toBe('> line one\n>\n> line two');
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
