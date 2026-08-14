import { describe, it, expect } from 'vitest';
import { documentShell } from './documentShell';
import { EXPORT_STYLES } from './exportStyles';

describe('documentShell', () => {
  it('produces a standalone document with the stylesheet inline', () => {
    const out = documentShell({ title: 'Notes', body: '<p>hi</p>' });
    expect(out.startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('<meta charset="utf-8">');
    expect(out).toContain('<title>Notes</title>');
    expect(out).toContain('<p>hi</p>');
    expect(out).toContain(EXPORT_STYLES.slice(0, 24));
  });

  it('escapes the title so a file name cannot break out of the tag', () => {
    const out = documentShell({ title: 'a</title><script>x()</script>', body: '' });
    expect(out).not.toContain('<script>x()</script>');
    expect(out).toContain('&lt;/title&gt;');
  });

  it('carries the extra head content through, for HTML documents', () => {
    const out = documentShell({ title: 't', body: '', extraHead: '<style>.k{color:red}</style>' });
    expect(out).toContain('.k{color:red}');
  });
});

describe('EXPORT_STYLES', () => {
  it('is light and does not depend on Edtr\'s bundled fonts', () => {
    // The file is opened on machines that do not have them (D5).
    expect(EXPORT_STYLES).not.toContain('Source Sans');
    expect(EXPORT_STYLES).not.toContain('var(--');
    expect(EXPORT_STYLES).toContain('@page');
  });
});
