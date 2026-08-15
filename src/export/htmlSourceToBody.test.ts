// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { htmlSourceToBody } from './htmlSourceToBody';

const SRC = [
  '<!doctype html><html><head>',
  '<style>.lead{color:#41576b}   .odd  {  margin : 0  }</style>',
  '</head><body class="page"><h1 class="lead">Title</h1><p>Text.</p></body></html>',
].join('');

describe('htmlSourceToBody', () => {
  it('takes the body content from the SOURCE, not from a projection', () => {
    const { body } = htmlSourceToBody(SRC);
    expect(body).toContain('<h1 class="lead">Title</h1>');
    expect(body).toContain('<p>Text.</p>');
  });

  it('keeps the file\'s own <style>, spacing and all', () => {
    // D4's whole point: the file already IS HTML, and round-tripping it
    // through ProseMirror would lose head, styles and verbatim atoms.
    const { head } = htmlSourceToBody(SRC);
    expect(head).toContain('.lead{color:#41576b}   .odd  {  margin : 0  }');
  });

  it('survives a document with no <style>', () => {
    const { body, head } = htmlSourceToBody('<html><body><p>x</p></body></html>');
    expect(body).toContain('<p>x</p>');
    expect(head).toBe('');
  });
});
