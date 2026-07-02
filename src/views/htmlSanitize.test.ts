// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { safeAttrs, sanitizeFragment } from './htmlSanitize';

describe('safeAttrs', () => {
  it('drops event-handler attrs', () => {
    const out = safeAttrs({ onclick: 'alert(1)', onerror: 'boom()', class: 'x' });
    expect(out).not.toHaveProperty('onclick');
    expect(out).not.toHaveProperty('onerror');
    expect(out.class).toBe('x');
  });

  it('neutralizes javascript: and vbscript: URL attrs by dropping them', () => {
    const out = safeAttrs({ href: 'javascript:alert(1)' });
    expect(out).not.toHaveProperty('href');

    const out2 = safeAttrs({ src: '  VBScript:msgbox(1)' });
    expect(out2).not.toHaveProperty('src');
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

  it('keeps data: image src urls', () => {
    const out = safeAttrs({ src: 'data:image/png;base64,AAAA' });
    expect(out.src).toBe('data:image/png;base64,AAAA');
  });

  it('handles missing/undefined attrs bag', () => {
    expect(safeAttrs(undefined as unknown as Record<string, string>)).toEqual({});
  });
});

describe('sanitizeFragment', () => {
  function fragmentFrom(html: string): DocumentFragment {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    return tpl.content;
  }

  it('removes <script> elements', () => {
    const frag = fragmentFrom('<div>hi</div><script>evil()</script>');
    sanitizeFragment(frag);
    expect(frag.querySelector('script')).toBeNull();
  });

  it('strips onerror from img elements', () => {
    const frag = fragmentFrom('<img src="x" onerror="boom()">');
    sanitizeFragment(frag);
    const img = frag.querySelector('img')!;
    expect(img.hasAttribute('onerror')).toBe(false);
    expect(img.getAttribute('src')).toBe('x');
  });

  it('strips javascript: hrefs from anchors', () => {
    const frag = fragmentFrom('<a href="javascript:alert(1)">click</a>');
    sanitizeFragment(frag);
    const a = frag.querySelector('a')!;
    expect(a.hasAttribute('href')).toBe(false);
  });

  it('leaves safe content untouched', () => {
    const frag = fragmentFrom('<div class="a"><a href="https://x">y</a></div>');
    sanitizeFragment(frag);
    expect(frag.querySelector('div')!.getAttribute('class')).toBe('a');
    expect(frag.querySelector('a')!.getAttribute('href')).toBe('https://x');
  });
});
