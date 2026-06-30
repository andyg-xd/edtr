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

describe('buildLiveDoc — inline content', () => {
  it('applies strong and emphasis marks', () => {
    const d = doc('**bold** and *italic*\n');
    const p = d.child(0);
    const boldText = p.child(0);
    expect(boldText.text).toBe('bold');
    expect(boldText.marks.map((m) => m.type.name)).toContain('strong');
    // find the emphasized run
    let sawEm = false;
    p.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type.name === 'em')) sawEm = true;
    });
    expect(sawEm).toBe(true);
  });

  it('applies inline code and strikethrough', () => {
    const code = doc('`x`\n').child(0).child(0);
    expect(code.text).toBe('x');
    expect(code.marks.map((m) => m.type.name)).toContain('code');

    let sawStrike = false;
    doc('~~gone~~\n').descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type.name === 'strikethrough')) sawStrike = true;
    });
    expect(sawStrike).toBe(true);
  });

  it('maps links with href and title to the link mark', () => {
    let link: any = null;
    doc('[t](https://x.test "ti")\n').descendants((n) => {
      const m = n.marks?.find((mm: any) => mm.type.name === 'link');
      if (m) link = m;
    });
    expect(link.attrs.href).toBe('https://x.test');
    expect(link.attrs.title).toBe('ti');
  });

  it('maps an image to an image node', () => {
    let img: any = null;
    doc('![alt](pic.png)\n').descendants((n) => {
      if (n.type.name === 'image') img = n;
    });
    expect(img.attrs.src).toBe('pic.png');
    expect(img.attrs.alt).toBe('alt');
  });

  it('maps a task list item checked state', () => {
    const list = doc('- [x] done\n- [ ] todo\n').child(0);
    expect(list.child(0).attrs.checked).toBe(true);
    expect(list.child(1).attrs.checked).toBe(false);
  });

  it('accumulates marks on nested strong+em (same leaf carries both)', () => {
    // remark parses ***bold-italic*** as emphasis > strong > text
    // both marks must be accumulated on the single text leaf
    let leaf: any = null;
    doc('***bold-italic***\n').descendants((n) => {
      if (n.isText && n.text === 'bold-italic') leaf = n;
    });
    expect(leaf).not.toBeNull();
    const names = leaf.marks.map((m: any) => m.type.name);
    expect(names).toContain('strong');
    expect(names).toContain('em');
  });

  it('falls back to raw text for unknown inline (inline html)', () => {
    // remark emits html-typed nodes with value="<abbr>" / value="</abbr>"
    // the unknown-inline branch emits node.value as raw text
    let sawText = false;
    doc('a <abbr>x</abbr> b\n').descendants((n) => {
      if (n.isText && n.text!.includes('<abbr>')) sawText = true;
    });
    expect(sawText).toBe(true);
  });

  it('maps an image title', () => {
    let img: any = null;
    doc('![alt](pic.png "the title")\n').descendants((n) => {
      if (n.type.name === 'image') img = n;
    });
    expect(img.attrs.title).toBe('the title');
  });
});

describe('buildLiveDoc — verbatim fallback', () => {
  it('renders a GFM table as a verbatim block holding its exact raw markdown', () => {
    const src = '| a | b |\n| - | - |\n| 1 | 2 |\n';
    const d = doc(src);
    const v = d.child(0);
    expect(v.type.name).toBe('verbatim');
    // raw must equal the exact source slice at the block's range (no reflow)
    expect(v.attrs.raw).toBe(src.slice(v.attrs.srcFrom, v.attrs.srcTo));
    expect(v.attrs.raw).toContain('| a | b |');
  });

  it('renders a raw HTML block as verbatim', () => {
    const src = '<div class="x">hi</div>\n';
    const d = doc(src);
    const v = d.child(0);
    expect(v.type.name).toBe('verbatim');
    expect(v.attrs.raw).toBe(src.slice(v.attrs.srcFrom, v.attrs.srcTo));
    expect(v.attrs.raw).toContain('<div');
  });

  it('keeps supported blocks structural even when a table is present (hybrid degradation)', () => {
    const src = '# Heading\n\n| a |\n| - |\n';
    const d = doc(src);
    expect(d.child(0).type.name).toBe('heading');
    const table = d.child(1);
    expect(table.type.name).toBe('verbatim');
    expect(table.attrs.raw).toBe(src.slice(table.attrs.srcFrom, table.attrs.srcTo));
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

describe('liveModel — top-level-only ranges + per-build ids', () => {
  it('does NOT put real source ranges on nested blocks (blockquote inner paragraph)', () => {
    const r = buildLiveDoc('> quoted text\n');
    if (!r.ok) throw new Error('degraded');
    const bq = r.doc.child(0);
    expect(bq.type.name).toBe('blockquote');
    expect(bq.attrs.srcFrom).toBeGreaterThanOrEqual(0);
    expect(bq.attrs.srcTo).toBeGreaterThan(bq.attrs.srcFrom); // top-level has a real range
    const innerP = bq.child(0);
    expect(innerP.type.name).toBe('paragraph');
    // nested paragraph carries schema DEFAULT range (0/0), not a real one
    expect(innerP.attrs.srcFrom).toBe(0);
    expect(innerP.attrs.srcTo).toBe(0);
    expect(innerP.attrs.blockId).toBe('');
  });

  it('still degrades when a nested block is unlocated', () => {
    const root = {
      type: 'root',
      children: [
        {
          type: 'blockquote',
          position: { start: { offset: 0 }, end: { offset: 5 } },
          children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }] /* no position */ }],
        },
      ],
    };
    const res = mdastToLiveDoc(root, '> x\n');
    expect(res.ok).toBe(false);
  });

  it('assigns deterministic per-build ids starting at b0 (no cross-build leakage)', () => {
    const a = buildLiveDoc('one\n\ntwo\n');
    const b = buildLiveDoc('three\n\nfour\n');
    if (!a.ok || !b.ok) throw new Error('degraded');
    expect(a.doc.child(0).attrs.blockId).toBe('b0');
    expect(b.doc.child(0).attrs.blockId).toBe('b0'); // each build restarts at b0
  });
});
