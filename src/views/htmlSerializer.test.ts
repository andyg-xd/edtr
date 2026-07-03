import { describe, it, expect } from 'vitest';
import { htmlSchema } from './htmlSchema';
import { toLiveHtml } from './htmlModel';
import { toSource } from './ViewSync';
import { serializeHtmlBlock, serializeHtmlDirty, HtmlSerializeError } from './htmlSerializer';

const SRC = `<!doctype html>
<html>
<head><style>p{color:red}</style></head>
<body>
<h1 class="title">Hello</h1>
<p>A <strong>bold</strong> and <em>italic</em> line.</p>
<table><tr><td>x</td></tr></table>
</body>
</html>
`;

function build(src: string) {
  const r = toLiveHtml(src);
  if (!r.ok) throw new Error(`toLiveHtml degraded: ${r.reason}`);
  return r.doc;
}

describe('serializeHtmlBlock — per construct', () => {
  it('serializes a paragraph with inline marks canonically', () => {
    const doc = build(SRC);
    const p = doc.child(1);
    expect(serializeHtmlBlock(p)).toBe('<p>A <strong>bold</strong> and <em>italic</em> line.</p>');
  });

  it('serializes a heading with its attrs and level', () => {
    const doc = build(SRC);
    expect(serializeHtmlBlock(doc.child(0))).toBe('<h1 class="title">Hello</h1>');
  });

  it('emits a verbatim atom raw, unescaped', () => {
    const doc = build(SRC);
    expect(serializeHtmlBlock(doc.child(2))).toBe('<table><tr><td>x</td></tr></table>');
  });

  it('maps each mark to its canonical tag', () => {
    const doc = build('<html><body><p>x</p></body></html>');
    const p = doc.child(0);
    const withMarks = htmlSchema.node('paragraph', p.attrs, [
      htmlSchema.text('a', [htmlSchema.marks.underline.create()]),
      htmlSchema.text('b', [htmlSchema.marks.strike.create()]),
      htmlSchema.text('c', [htmlSchema.marks.code.create()]),
    ]);
    expect(serializeHtmlBlock(withMarks)).toBe('<p><u>a</u><s>b</s><code>c</code></p>');
  });

  it('coalesces an adjacent same-mark run into one tag pair', () => {
    const doc = build('<html><body><p>x</p></body></html>');
    const p = doc.child(0);
    const m = htmlSchema.marks.strong.create();
    const node = htmlSchema.node('paragraph', p.attrs, [
      htmlSchema.text('foo', [m]),
      htmlSchema.text('bar', [m]),
    ]);
    expect(serializeHtmlBlock(node)).toBe('<p><strong>foobar</strong></p>');
  });

  it('serializes a link mark with its href from the htmlAttrs bag', () => {
    const doc = build('<html><body><p>x</p></body></html>');
    const p = doc.child(0);
    const link = htmlSchema.marks.link.create({ htmlAttrs: { href: 'https://a.test' } });
    const node = htmlSchema.node('paragraph', p.attrs, [htmlSchema.text('go', [link])]);
    expect(serializeHtmlBlock(node)).toBe('<p><a href="https://a.test">go</a></p>');
  });

  it('serializes nested div/list children recursively', () => {
    const doc = build('<html><body><div class="w"><p>hi</p></div></body></html>');
    expect(serializeHtmlBlock(doc.child(0))).toBe('<div class="w"><p>hi</p></div>');
  });

  it('unwraps a single-paragraph list item to inline', () => {
    const doc = build('<html><body><ul><li>one</li><li>two</li></ul></body></html>');
    expect(serializeHtmlBlock(doc.child(0))).toBe('<ul><li>one</li><li>two</li></ul>');
  });

  it('keeps a genuine <li><p class="x">…</p></li> wrapped (attrs would be lost by unwrapping)', () => {
    const doc = build('<html><body><ul><li><p class="x">hi</p></li></ul></body></html>');
    expect(serializeHtmlBlock(doc.child(0))).toBe('<ul><li><p class="x">hi</p></li></ul>');
  });

  it('serializes an existing <img> from htmlAttrs (no displaySrc)', () => {
    const doc = build('<html><body><p><img src="pic.png" alt="a"></p></body></html>');
    expect(serializeHtmlBlock(doc.child(0))).toBe('<p><img src="pic.png" alt="a"></p>');
  });

  it('round-trips a linked image — the <a> wraps the <img> (marked atom)', () => {
    const doc = build('<html><body><p><a href="x"><img src="y"></a></p></body></html>');
    expect(serializeHtmlBlock(doc.child(0))).toBe('<p><a href="x"><img src="y"></a></p>');
  });

  it('escapes text and attribute values for round-trip', () => {
    const doc = build('<html><body><p>x</p></body></html>');
    const p = doc.child(0);
    const link = htmlSchema.marks.link.create({ htmlAttrs: { href: 'a"b&c' } });
    const node = htmlSchema.node('paragraph', p.attrs, [
      htmlSchema.text('1 < 2 & 3', []),
      htmlSchema.text('L', [link]),
    ]);
    expect(serializeHtmlBlock(node)).toBe('<p>1 &lt; 2 &amp; 3<a href="a&quot;b&amp;c">L</a></p>');
  });

  it('throws HtmlSerializeError on an unknown node type', () => {
    const bad = htmlSchema.node('hardBreak'); // not a block
    expect(() => serializeHtmlBlock(bad)).toThrow(HtmlSerializeError);
  });
});

describe('no-beautify via toSource + serializeHtmlDirty', () => {
  it('no-op round-trip is byte-identical', () => {
    const doc = build(SRC);
    expect(toSource(doc, SRC, serializeHtmlDirty(new Set()))).toBe(SRC);
  });

  it('editing one block changes only that block; head + siblings byte-identical', () => {
    const doc = build(SRC);
    const p = doc.child(1);
    const edited = htmlSchema.node('paragraph', p.attrs, [htmlSchema.text('Changed')]);
    const doc2 = htmlSchema.node('doc', null, [doc.child(0), edited, doc.child(2)]);
    const out = toSource(doc2, SRC, serializeHtmlDirty(new Set([p.attrs.blockId as string])));
    expect(out).toContain('<h1 class="title">Hello</h1>');                 // sibling untouched
    expect(out).toContain('<table><tr><td>x</td></tr></table>');          // verbatim untouched
    expect(out).toContain('<style>p{color:red}</style>');                 // head untouched
    expect(out).toContain('<p>Changed</p>');                              // block re-serialized
    expect(out).not.toContain('bold');                                    // old content gone
  });

  it('a clean block with non-canonical source formatting is byte-sliced, not re-serialized', () => {
    // SRC above is already in canonical form, so a hypothetical bug where
    // serializeHtmlDirty ignores `dirty` and always re-serializes would still
    // pass the two goldens above (re-serializing canonical bytes reproduces
    // the same bytes). This golden uses non-canonical formatting (double
    // space, single-quoted attr) so a dirty-gating regression is detectable:
    // re-serializing would canonicalize it, changing the bytes.
    const nonCanonicalSrc = `<html><body><h1  class='title'>Hi</h1></body></html>`;
    const doc = build(nonCanonicalSrc);
    const h1 = doc.child(0);
    // Sanity check: prove re-serialization WOULD differ from the source slice,
    // so a regression to "always re-serialize" is actually caught below.
    expect(serializeHtmlBlock(h1)).not.toBe(
      nonCanonicalSrc.slice(h1.attrs.srcFrom as number, h1.attrs.srcTo as number),
    );
    const out = toSource(doc, nonCanonicalSrc, serializeHtmlDirty(new Set()));
    expect(out).toBe(nonCanonicalSrc);
  });

  it('a verbatim table stays byte-identical when a sibling is edited', () => {
    const doc = build(SRC);
    const p = doc.child(1);
    const edited = htmlSchema.node('paragraph', p.attrs, [htmlSchema.text('Z')]);
    const doc2 = htmlSchema.node('doc', null, [doc.child(0), edited, doc.child(2)]);
    const out = toSource(doc2, SRC, serializeHtmlDirty(new Set([p.attrs.blockId as string])));
    const before = SRC.indexOf('<table>');
    expect(out.slice(out.indexOf('<table>'))).toBe(SRC.slice(before));
  });
});

describe('schema exhaustiveness', () => {
  it('every block-group node has a serializer arm', () => {
    for (const name of Object.keys(htmlSchema.nodes)) {
      const type = htmlSchema.nodes[name];
      if (type.spec.group !== 'block') continue;
      // A block node must serialize without an "unknown block" throw.
      const node = name === 'verbatim'
        ? type.create({ raw: '<x></x>' })
        : type.createAndFill();
      expect(node).not.toBeNull();
      expect(() => serializeHtmlBlock(node as any)).not.toThrow(/unknown block/);
    }
  });
});
