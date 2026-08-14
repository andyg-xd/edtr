// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { toLive } from '../views/ViewSync';
import { liveSchema } from '../views/liveSchema';
import { pmToHtml } from './pmToHtml';

function html(src: string): string {
  const r = toLive(src, null);
  if (!r.ok) throw new Error('fixture failed to project');
  return pmToHtml(r.doc);
}

describe('pmToHtml', () => {
  it('renders headings, paragraphs and inline marks', () => {
    const out = html('# Title\n\nSome **bold** and *italic* text.\n');
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
  });

  it('carries NO editor-only artifacts', () => {
    // Guaranteed by construction (we serialize the document, not the live
    // DOM), and asserted anyway so the property is locked in.
    const out = html('# Title\n\nA paragraph.\n');
    expect(out).not.toContain('blockId');
    expect(out).not.toContain('blockid');
    expect(out).not.toContain('contenteditable');
    expect(out).not.toContain('ProseMirror');
  });

  it('emits the real relative src, never the asset-protocol displaySrc', () => {
    const r = toLive('![alt](pics/photo.png)\n', null);
    if (!r.ok) throw new Error('fixture failed');
    const out = pmToHtml(r.doc);
    expect(out).toContain('src="pics/photo.png"');
    expect(out).not.toContain('asset.localhost');
    expect(out).not.toContain('displaySrc');
  });

  // The test above cannot actually vacuity-fail: `toLive(src, null)` never
  // resolves a real asset-protocol URL (`resolveImageDisplaySrc` returns
  // `src` verbatim when `docPath` is falsy — imageAssets.ts:35), so
  // `displaySrc === src` already, and the strip-before-serialize step is
  // never exercised by it. Hand-building a node where the two attrs
  // genuinely disagree is the only way to prove the strip is load-bearing.
  it('strips a real (non-trivial) displaySrc that differs from src', () => {
    const image = liveSchema.node('image', {
      src: 'pics/photo.png',
      displaySrc: 'asset://localhost/Users/x/doc.assets/photo.png',
    });
    const doc = liveSchema.node('doc', null, [liveSchema.node('paragraph', null, [image])]);
    const out = pmToHtml(doc);
    expect(out).toContain('src="pics/photo.png"');
    expect(out).not.toContain('asset://localhost');
  });

  it('renders a bullet list', () => {
    // A list item's content is `block+` (liveSchema.ts:65-75), so its text
    // is always wrapped in a paragraph, even for a single-line item.
    expect(html('- one\n- two\n')).toContain('<ul><li><p>one</p></li><li><p>two</p></li></ul>');
  });

  it('renders an ordered list', () => {
    expect(html('1. one\n2. two\n')).toContain('<ol><li><p>one</p></li><li><p>two</p></li></ol>');
  });

  it('renders a nested list', () => {
    const out = html('- one\n  - inner\n');
    expect(out).toContain('<ul><li><p>one</p><ul><li><p>inner</p></li></ul></li></ul>');
  });

  it('renders a blockquote', () => {
    expect(html('> quoted\n')).toContain('<blockquote><p>quoted</p></blockquote>');
  });

  it('renders a code block', () => {
    expect(html('```\ncode\n```\n')).toContain('<pre><code>code</code></pre>');
  });

  it('renders a horizontal rule', () => {
    expect(html('---\n')).toContain('<hr>');
  });

  it('renders a link', () => {
    expect(html('[text](https://example.com)\n')).toContain('<a href="https://example.com">text</a>');
  });

  it('renders inline code', () => {
    expect(html('Some `code` here.\n')).toContain('<code>code</code>');
  });

  it('renders a GFM table with header row and column alignment', () => {
    const out = html('| A | B |\n| --- | :-: |\n| 1 | 2 |\n');
    // jsdom re-serializes the inline `style` attribute with its own
    // normalized spacing/semicolon, not the exact string `toDOM` set it to.
    expect(out).toContain('<table><tbody><tr><th>A</th><th style="text-align: center;">B</th></tr>'
      + '<tr><td>1</td><td style="text-align: center;">2</td></tr></tbody></table>');
  });

  it('agrees structurally with what the editor renders (D3)', () => {
    const r = toLive('# Title\n\n- one\n- two\n\n> quote\n', null);
    if (!r.ok) throw new Error('fixture failed');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = new EditorView(host, { state: EditorState.create({ doc: r.doc }) });

    // EditorView adds these; toDOM does not. Removing them is the whole
    // difference between the two renderings — if anything ELSE differs, the
    // export and the editor have drifted and D3 is false.
    const editor = view.dom.cloneNode(true) as HTMLElement;
    editor.removeAttribute('class');
    editor.removeAttribute('contenteditable');
    editor.removeAttribute('translate');
    for (const el of Array.from(editor.querySelectorAll('*'))) {
      el.removeAttribute('contenteditable');
      if (el.getAttribute('class') === '') el.removeAttribute('class');
    }

    expect(editor.innerHTML).toBe(pmToHtml(r.doc));
    view.destroy(); host.remove();
  });
});
