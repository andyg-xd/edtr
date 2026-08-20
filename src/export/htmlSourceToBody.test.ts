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

describe('htmlSourceToBody — an export never executes', () => {
  const WITH_SCRIPT = [
    '<!doctype html><html><head>',
    '<style>.a{color:red}</style>',
    '<script>window.headRan = true;</scr' + 'ipt>',
    '<link rel="stylesheet" href="theme.css">',
    '</head><body><p>Text.</p>',
    '<script>window.bodyRan = true;</scr' + 'ipt>',
    '<link rel="stylesheet" href="late.css">',
    '<style>.b{color:blue}</style>',
    '</body></html>',
  ].join('');

  it('strips a script from the BODY, not only from the head', () => {
    // Owner decision (2026-08-20): one rule, no exceptions. Head scripts were
    // already dropped by construction (the head extractor only collects
    // <style>), while a body script rode through verbatim -- an incoherent
    // position either way.
    const { body } = htmlSourceToBody(WITH_SCRIPT);
    expect(body).not.toContain('bodyRan');
    expect(body).not.toContain('<script');
    expect(body).toContain('<p>Text.</p>');
  });

  it('strips a stylesheet LINK from the body too', () => {
    // Same rule as the head, and it could not have worked anyway: only
    // images are inlined, so the exported file would point at a stylesheet
    // that is not sitting next to it.
    const { body } = htmlSourceToBody(WITH_SCRIPT);
    expect(body).not.toContain('late.css');
  });

  it('keeps a <style> block wherever it appears — styling is not execution', () => {
    const { body, head } = htmlSourceToBody(WITH_SCRIPT);
    expect(head).toContain('.a{color:red}');
    expect(body).toContain('.b{color:blue}');
  });

  it('never carries the head script through either', () => {
    const { body, head } = htmlSourceToBody(WITH_SCRIPT);
    expect(head).not.toContain('headRan');
    expect(body).not.toContain('headRan');
  });
});
