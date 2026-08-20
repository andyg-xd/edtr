import { describe, it, expect } from 'vitest';
import { plaintextToBody } from './plaintextToBody';

describe('plaintextToBody', () => {
  it('preserves the text verbatim inside a <pre>', () => {
    // A .txt file has no markup to interpret, so the export shows it exactly
    // as written -- spacing, blank lines and all.
    const body = plaintextToBody('one\n\n    indented\nlast');
    expect(body).toContain('one\n\n    indented\nlast');
    expect(body.startsWith('<pre')).toBe(true);
    expect(body.endsWith('</pre>')).toBe(true);
  });

  it('escapes markup so a text file is never interpreted as HTML', () => {
    // The whole reason plaintext was disabled before this: text is NOT
    // markup. `<b>` in a .txt is three visible characters, and a <script>
    // line is text a reader should SEE, never something an export runs.
    const body = plaintextToBody('a <b>bold</b> & <script>alert(1)</script>');
    expect(body).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(body).toContain('&amp;');
    expect(body).not.toContain('<script>');
    expect(body).toContain('&lt;script&gt;');
  });

  it('does not reinterpret Markdown syntax', () => {
    // The alternative rejected here: routing .txt through the Markdown
    // parser, where a leading `#` silently becomes a heading.
    const body = plaintextToBody('# Not a heading\n*not emphasis*');
    expect(body).toContain('# Not a heading');
    expect(body).not.toContain('<h1');
    expect(body).not.toContain('<em>');
  });

  it('handles an empty file without producing a broken element', () => {
    expect(plaintextToBody('')).toBe('<pre class="plaintext"></pre>');
  });
});
