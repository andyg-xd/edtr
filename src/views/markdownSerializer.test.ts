import { describe, it, expect } from 'vitest';
import { liveSchema } from './liveSchema';
import { escapeInline, serializeInline, serializeBlock } from './markdownSerializer';
import type { FlavorProfile } from '../doc/types';
import { parseMarkdownAst } from '../doc/parse';
import { detectFlavor } from '../doc/flavor';

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
  it('serializes an image from src only — displaySrc never leaks (no-beautify guard)', () => {
    const p = para(
      liveSchema.node('image', {
        src: 'notes.assets/p.png',
        alt: 'cap',
        displaySrc: 'CONVERTED:/abs/notes.assets/p.png',
      }),
    );
    const out = serializeInline(p, star);
    expect(out).toBe('![cap](notes.assets/p.png)');
    expect(out).not.toContain('CONVERTED');
  });
});

// Round-trip helper: build a paragraph with a single code-marked text node,
// serialize it, parse the result, and assert the inlineCode value is identical.
function codeNode(value: string) {
  return para(liveSchema.text(value, [liveSchema.marks.code.create()]));
}
function parseFirstInlineCode(md: string): string {
  const ast = parseMarkdownAst(md);
  // ast is root → paragraph → inlineCode
  const para = ast.children?.[0];
  const node = para?.children?.[0];
  if (!node || node.type !== 'inlineCode') throw new Error(`Expected inlineCode, got ${node?.type} in: ${md}`);
  return node.value;
}

describe('serializeInline — inline code round-trip (variable-length backtick fence)', () => {
  // Baseline: no backticks in text → single-backtick fence (existing behavior unchanged)
  it('x*y (no backticks) → `x*y` and round-trips', () => {
    const serialized = serializeInline(codeNode('x*y'), star);
    expect(serialized).toBe('`x*y`');
    expect(parseFirstInlineCode(serialized)).toBe('x*y');
  });

  // One backtick inside → needs double-backtick fence
  it('a`b (one backtick) round-trips', () => {
    const serialized = serializeInline(codeNode('a`b'), star);
    expect(parseFirstInlineCode(serialized)).toBe('a`b');
  });

  // Two consecutive backticks inside → needs triple-backtick fence
  it('a``b (two consecutive backticks) round-trips', () => {
    const serialized = serializeInline(codeNode('a``b'), star);
    expect(parseFirstInlineCode(serialized)).toBe('a``b');
  });

  // Leading backtick → needs padding so the fence-open isn't consumed as content
  it('`lead (leading backtick) round-trips', () => {
    const serialized = serializeInline(codeNode('`lead'), star);
    expect(parseFirstInlineCode(serialized)).toBe('`lead');
  });

  // Trailing backtick → same issue on close side
  it('trail` (trailing backtick) round-trips', () => {
    const serialized = serializeInline(codeNode('trail`'), star);
    expect(parseFirstInlineCode(serialized)).toBe('trail`');
  });

  // Entire text is backticks → longest run = 3, fence must be 4, with padding
  it('``` (all backticks) round-trips', () => {
    const serialized = serializeInline(codeNode('```'), star);
    expect(parseFirstInlineCode(serialized)).toBe('```');
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
  it('throws on an unknown block type (no lossy silent fallback)', () => {
    // liveSchema has no such node; fake a node-like object exercising the default arm.
    const fake = { type: { name: 'someFutureBlock' }, textContent: 'x', attrs: {} } as unknown as import('prosemirror-model').Node;
    expect(() => serializeBlock(fake, star)).toThrow(/unsupported block type: someFutureBlock/i);
  });
});

// Helpers for whitespace-around-mark round-trip tests.
function parseFirstParagraphChildren(md: string): any[] {
  const ast = parseMarkdownAst(md);
  const para = ast.children?.[0];
  return para?.children ?? [];
}

describe('serializeInline — whitespace outside symmetric marks (round-trip)', () => {
  it('bold text with trailing space: emits **a** and round-trips', () => {
    // text "a " with strong mark
    const p = para(liveSchema.text('a ', [liveSchema.marks.strong.create()]));
    const serialized = serializeInline(p, star);
    // trailing space must be outside the delimiters
    expect(serialized).toBe('**a** ');
    // round-trip: parse back and recover strong on "a", space literal
    const children = parseFirstParagraphChildren(serialized);
    expect(children.some((n: any) => n.type === 'strong')).toBe(true);
    const strongNode = children.find((n: any) => n.type === 'strong');
    expect(strongNode?.children?.[0]?.value).toBe('a');
  });

  it('bold whitespace-only: emits no ** delimiters and round-trips with no strong', () => {
    const p = para(liveSchema.text(' ', [liveSchema.marks.strong.create()]));
    const serialized = serializeInline(p, star);
    // no mark delimiters should wrap a whitespace-only span
    expect(serialized).not.toContain('**');
    // round-trip: the output parses without a strong node
    const ast = parseMarkdownAst(serialized);
    const paraNode = ast.children?.[0];
    const hasStrong = (paraNode?.children ?? []).some((n: any) => n.type === 'strong');
    expect(hasStrong).toBe(false);
  });

  it('mixed: bold code + bold space + plain text has no stray **', () => {
    // Simulates: "html" (bold+code) + " " (bold) + "files" (plain)
    const p = para(
      liveSchema.text('html', [liveSchema.marks.strong.create(), liveSchema.marks.code.create()]),
      liveSchema.text(' ', [liveSchema.marks.strong.create()]),
      liveSchema.text('files'),
    );
    const serialized = serializeInline(p, star);
    // The bold+code span serializes fine; the trailing bold space should NOT emit **
    expect(serialized).not.toMatch(/\*\* \*\*/);
    // "files" must be present in output
    expect(serialized).toContain('files');
  });
});

describe('serializeBlock — structural-editing coverage', () => {
  const flavor = detectFlavor('x\n', 'markdown');

  it('an empty paragraph serializes to the empty string', () => {
    const empty = liveSchema.node('paragraph');
    expect(serializeBlock(empty, flavor)).toBe('');
  });

  it('a nested list (list item containing a sublist) serializes with indentation', () => {
    // Build: bulletList > listItem > [ paragraph "a", bulletList > listItem > paragraph "b" ]
    const sub = liveSchema.node('bulletList', null, [
      liveSchema.node('listItem', { checked: null }, [liveSchema.node('paragraph', null, [liveSchema.text('b')])]),
    ]);
    const outer = liveSchema.node('bulletList', null, [
      liveSchema.node('listItem', { checked: null }, [
        liveSchema.node('paragraph', null, [liveSchema.text('a')]),
        sub,
      ]),
    ]);
    const out = serializeBlock(outer, flavor);
    expect(out.split('\n')[0]).toMatch(/^[-*+] a$/); // top item
    expect(out).toMatch(/\n\s+[-*+] b$/);            // sub item is indented under it
  });
});

describe('serializeBlock — GFM table', () => {
  const flavor = detectFlavor('x\n', 'markdown');
  const { table, tableRow, tableCell } = liveSchema.nodes;
  const cell = (text: string, attrs = {}) =>
    tableCell.create(attrs, text ? [liveSchema.text(text)] : undefined);

  it('serializes header + delimiter (all four alignments) + body', () => {
    const t = table.create(null, [
      tableRow.create(null, [
        cell('A', { header: true, align: null }),
        cell('B', { header: true, align: 'left' }),
        cell('C', { header: true, align: 'center' }),
        cell('D', { header: true, align: 'right' }),
      ]),
      tableRow.create(null, [cell('1'), cell('2'), cell('3'), cell('4')]),
    ]);
    expect(serializeBlock(t, flavor)).toBe('| A | B | C | D |\n| --- | :-- | :-: | --: |\n| 1 | 2 | 3 | 4 |');
  });

  it('escapes pipes in cell content', () => {
    const t = table.create(null, [
      tableRow.create(null, [cell('a|b', { header: true })]),
      tableRow.create(null, [cell('c')]),
    ]);
    expect(serializeBlock(t, flavor)).toBe('| a\\|b |\n| --- |\n| c |');
  });

  it('serializes an in-cell hard break as <br>', () => {
    const c = tableCell.create({ header: false }, [
      liveSchema.text('a'), liveSchema.node('hardBreak'), liveSchema.text('b'),
    ]);
    const t = table.create(null, [
      tableRow.create(null, [cell('H', { header: true })]),
      tableRow.create(null, [c]),
    ]);
    expect(serializeBlock(t, flavor)).toBe('| H |\n| --- |\n| a<br>b |');
  });
});

describe('serializeBlock — multi-child + schema-exhaustiveness', () => {
  const flavor = detectFlavor('x\n', 'markdown');

  it('a multi-paragraph blockquote serializes with blank quote lines as ">"', () => {
    const bq = liveSchema.node('blockquote', null, [
      liveSchema.node('paragraph', null, [liveSchema.text('a')]),
      liveSchema.node('paragraph', null, [liveSchema.text('b')]),
      liveSchema.node('paragraph', null, [liveSchema.text('c')]),
    ]);
    expect(serializeBlock(bq, flavor)).toBe('> a\n>\n> b\n>\n> c');
  });

  it('a multi-item bullet list serializes one line per item', () => {
    const item = (t: string) =>
      liveSchema.node('listItem', { checked: null }, [liveSchema.node('paragraph', null, [liveSchema.text(t)])]);
    const list = liveSchema.node('bulletList', null, [item('a'), item('b'), item('c')]);
    expect(serializeBlock(list, flavor)).toBe('- a\n- b\n- c');
  });

  it('serializeBlock handles EVERY block-group schema node (build-failing guard)', () => {
    for (const type of Object.values(liveSchema.nodes)) {
      if (type.spec.group !== 'block') continue; // only top-level block nodes
      const node = type.createAndFill();          // minimal valid instance
      if (!node) throw new Error(`could not construct a ${type.name} for the exhaustiveness check`);
      expect(() => serializeBlock(node, flavor)).not.toThrow();
    }
  });
});
