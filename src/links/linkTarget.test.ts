import { describe, it, expect } from 'vitest';
import { classifyLink } from './linkTarget';

const DOC = '/Users/me/project/docs/plan.md';

describe('classifyLink — web and email', () => {
  it('opens https and http links as they are', () => {
    expect(classifyLink('https://example.com/a?b=1#c', DOC)).toEqual({ kind: 'web', url: 'https://example.com/a?b=1#c' });
    expect(classifyLink('http://example.com', DOC)).toEqual({ kind: 'web', url: 'http://example.com' });
  });

  it('accepts an upper-case scheme and surrounding whitespace', () => {
    expect(classifyLink('  HTTPS://Example.com  ', DOC)).toEqual({ kind: 'web', url: 'HTTPS://Example.com' });
  });

  it('opens mailto links', () => {
    expect(classifyLink('mailto:someone@example.com', DOC)).toEqual({ kind: 'web', url: 'mailto:someone@example.com' });
  });

  it('treats a protocol-relative link as https', () => {
    expect(classifyLink('//example.com/x', DOC)).toEqual({ kind: 'web', url: 'https://example.com/x' });
  });

  it('works for web links in a document that has never been saved', () => {
    expect(classifyLink('https://example.com', null)).toEqual({ kind: 'web', url: 'https://example.com' });
  });
});

describe('classifyLink — files Edtr can open', () => {
  it('resolves ./ and bare names against the document folder', () => {
    expect(classifyLink('./notes.md', DOC)).toEqual({ kind: 'file', path: '/Users/me/project/docs/notes.md' });
    expect(classifyLink('notes.md', DOC)).toEqual({ kind: 'file', path: '/Users/me/project/docs/notes.md' });
  });

  it('resolves ../ segments', () => {
    expect(classifyLink('../site/index.html', DOC)).toEqual({ kind: 'file', path: '/Users/me/project/site/index.html' });
    expect(classifyLink('a/../../b.htm', DOC)).toEqual({ kind: 'file', path: '/Users/me/project/b.htm' });
  });

  it('keeps absolute paths', () => {
    expect(classifyLink('/Users/me/other.markdown', DOC)).toEqual({ kind: 'file', path: '/Users/me/other.markdown' });
  });

  it('accepts file:// URLs', () => {
    expect(classifyLink('file:///Users/me/My%20Notes.txt', DOC)).toEqual({ kind: 'file', path: '/Users/me/My Notes.txt' });
  });

  it('decodes %20 and friends', () => {
    expect(classifyLink('Meeting%20notes.md', DOC)).toEqual({ kind: 'file', path: '/Users/me/project/docs/Meeting notes.md' });
  });

  it('drops a ?query or #fragment on a file link', () => {
    expect(classifyLink('notes.md#setup', DOC)).toEqual({ kind: 'file', path: '/Users/me/project/docs/notes.md' });
    expect(classifyLink('page.html?v=2#top', DOC)).toEqual({ kind: 'file', path: '/Users/me/project/docs/page.html' });
  });

  it('matches the extension case-insensitively', () => {
    expect(classifyLink('README.MD', DOC)).toEqual({ kind: 'file', path: '/Users/me/project/docs/README.MD' });
  });
});

describe('classifyLink — never opened', () => {
  it('a #section link is a section, not a file', () => {
    expect(classifyLink('#features', DOC)).toEqual({ kind: 'section' });
  });

  it('refuses script and data links', () => {
    expect(classifyLink('javascript:alert(1)', DOC)).toEqual({ kind: 'unsupported', reason: 'scheme' });
    expect(classifyLink('java\tscript:alert(1)', DOC)).toEqual({ kind: 'unsupported', reason: 'scheme' });
    expect(classifyLink('data:text/html,<b>x</b>', DOC)).toEqual({ kind: 'unsupported', reason: 'scheme' });
  });

  it('refuses other schemes, including tel and ftp', () => {
    expect(classifyLink('ftp://example.com/a.md', DOC)).toEqual({ kind: 'unsupported', reason: 'scheme' });
    expect(classifyLink('tel:+15551234', DOC)).toEqual({ kind: 'unsupported', reason: 'scheme' });
    expect(classifyLink('vscode://file/x', DOC)).toEqual({ kind: 'unsupported', reason: 'scheme' });
  });

  it('refuses files Edtr does not edit, so a link can never launch a program', () => {
    for (const href of ['run.command', 'App.app', 'setup.sh', 'photo.png', 'notes', 'file:///Applications/Calculator.app']) {
      expect(classifyLink(href, DOC), href).toEqual({ kind: 'unsupported', reason: 'file-type' });
    }
  });

  it('cannot resolve a relative link in a document that has never been saved', () => {
    expect(classifyLink('./notes.md', null)).toEqual({ kind: 'unsupported', reason: 'unsaved' });
  });

  it('refuses an empty link', () => {
    expect(classifyLink('', DOC)).toEqual({ kind: 'unsupported', reason: 'empty' });
    expect(classifyLink('   ', DOC)).toEqual({ kind: 'unsupported', reason: 'empty' });
  });

  it('refuses a link whose escapes are malformed rather than throwing', () => {
    expect(classifyLink('bad%E0%A4%A.md', DOC)).toEqual({ kind: 'unsupported', reason: 'malformed' });
  });
});
