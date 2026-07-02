import DOMPurify from 'dompurify';

// Render-time sanitization for the read-only HTML Live view. The PM model
// (htmlAttrs / verbatim raw) stays verbatim — sanitization happens only when
// content is materialized into the shadow DOM, so 4b's byte-fidelity write-back
// later still sees the untouched source.
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'background']);
// Navigational URL attrs where a `data:` URL is also unsafe (data:text/html etc.).
const NAV_URL_ATTRS = new Set(['href', 'action', 'formaction', 'xlink:href']);
const DANGEROUS_SCHEME = /^(javascript|vbscript):/i;

/** Normalize a URL value the way a browser does before scheme resolution:
 *  strip ASCII tab/newline/CR (which browsers ignore) so obfuscated schemes
 *  like "java\tscript:" can't slip past. */
function normalizeUrl(v: string): string {
  return v.replace(/[\t\n\r]/g, '').trim();
}

/** Drop event-handler attrs (on*) and neutralize dangerous-scheme URL attrs.
 *  For TYPED nodes (known-safe tags); the verbatim path uses sanitizeHtml. */
export function safeAttrs(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (/^on/i.test(k)) continue;
    const key = k.toLowerCase();
    if (URL_ATTRS.has(key)) {
      const norm = normalizeUrl(v);
      if (DANGEROUS_SCHEME.test(norm)) continue;
      if (NAV_URL_ATTRS.has(key) && /^data:/i.test(norm)) continue; // data:text/html nav is unsafe
    }
    out[k] = v;
  }
  return out;
}

/** Sanitize arbitrary HTML (the verbatim escape hatch) with DOMPurify before it
 *  is rendered into the live shadow DOM. Forbids script-capable elements so no
 *  JS can execute; DOMPurify also strips on* / javascript: / srcdoc / mXSS
 *  vectors. */
export function sanitizeHtml(raw: string): string {
  return DOMPurify.sanitize(raw, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'form'],
  });
}
