// Render-time sanitization for the read-only HTML Live view. The PM model
// (htmlAttrs / verbatim raw) stays verbatim — sanitization happens only when
// content is materialized into the shadow DOM via toDOM, so 4b's byte-fidelity
// write-back later still sees the untouched source.
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'background']);
const DANGEROUS_SCHEME = /^\s*(javascript|vbscript):/i;

/** Drop event-handler attrs (on*) and neutralize dangerous-scheme URL attrs. */
export function safeAttrs(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (/^on/i.test(k)) continue;
    if (URL_ATTRS.has(k.toLowerCase()) && DANGEROUS_SCHEME.test(v)) continue;
    out[k] = v;
  }
  return out;
}

/** In-place: strip <script>, event-handler attrs, and dangerous URL attrs from a parsed fragment/subtree before it's rendered into the DOM. */
export function sanitizeFragment(root: DocumentFragment | Element): void {
  root.querySelectorAll('script').forEach((s) => s.remove());
  root.querySelectorAll('*').forEach((el) => {
    for (const name of el.getAttributeNames()) {
      const val = el.getAttribute(name) ?? '';
      if (/^on/i.test(name) || (URL_ATTRS.has(name.toLowerCase()) && DANGEROUS_SCHEME.test(val))) {
        el.removeAttribute(name);
      }
    }
  });
}
