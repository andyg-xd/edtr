// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { safeAttrs, sanitizeHtml } from './htmlSanitize';

describe('safeAttrs', () => {
  it('drops event-handler attrs', () => {
    const out = safeAttrs({ onclick: 'alert(1)', onerror: 'boom()', class: 'x' });
    expect(out).not.toHaveProperty('onclick');
    expect(out).not.toHaveProperty('onerror');
    expect(out.class).toBe('x');
  });

  it('neutralizes javascript: and vbscript: URL attrs by dropping them', () => {
    expect(safeAttrs({ href: 'javascript:alert(1)' })).not.toHaveProperty('href');
    expect(safeAttrs({ src: '  VBScript:msgbox(1)' })).not.toHaveProperty('src');
  });

  it('neutralizes tab/newline-obfuscated schemes browsers still resolve', () => {
    expect(safeAttrs({ href: 'java\tscript:alert(1)' })).not.toHaveProperty('href');
    expect(safeAttrs({ href: 'java\nscript:alert(1)' })).not.toHaveProperty('href');
    expect(safeAttrs({ href: 'java\r\nscript:alert(1)' })).not.toHaveProperty('href');
  });

  it('drops data: URLs on navigational attrs (data:text/html) but keeps them on img src', () => {
    expect(safeAttrs({ href: 'data:text/html,<script>x</script>' })).not.toHaveProperty('href');
    expect(safeAttrs({ src: 'data:image/png;base64,AAA' }).src).toBe('data:image/png;base64,AAA');
  });

  it('keeps safe attrs unchanged', () => {
    const out = safeAttrs({
      class: 'lead',
      id: 'p1',
      href: 'https://example.com',
      src: './a.png',
    });
    expect(out).toEqual({
      class: 'lead',
      id: 'p1',
      href: 'https://example.com',
      src: './a.png',
    });
  });

  it('handles missing/undefined attrs bag', () => {
    expect(safeAttrs(undefined as unknown as Record<string, string>)).toEqual({});
  });
});

describe('sanitizeHtml', () => {
  it('strips script-capable elements, srcdoc iframes, objects, and event handlers', () => {
    const out = sanitizeHtml(
      '<img src=x onerror="e()">' +
        '<script>s()</script>' +
        '<iframe srcdoc="<script>x</script>"></iframe>' +
        '<object data="javascript:e()"></object>',
    );
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('<object');
    expect(out.toLowerCase()).not.toContain('onerror');
    expect(out).not.toContain('srcdoc');
  });

  it('drops javascript: hrefs but keeps safe content', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">a</a><div class="k">hi</div>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('class="k"');
    expect(out).toContain('hi');
  });
});
