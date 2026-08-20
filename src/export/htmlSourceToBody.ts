/**
 * An HTML document's exportable parts, taken from the SOURCE (6c-iii, D4).
 *
 * Not from the ProseMirror projection: the file already is HTML, and a
 * round trip through the editor's schema would drop `<head>`, the file's own
 * `<style>`, and anything held as a verbatim atom — for no benefit, since
 * there is nothing to render.
 *
 * Uses DOMParser rather than a regex: the browser's parser is the same one
 * that will open the exported file, so anything it tolerates here it will
 * tolerate there.
 */
export function htmlSourceToBody(source: string): { body: string; head: string } {
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  const head = Array.from(parsed.querySelectorAll('head style'))
    .map((s) => s.outerHTML)
    .join('\n');

  // An export never executes (owner decision, 2026-08-20). Head scripts and
  // stylesheet links were already dropped by construction — the head
  // extractor above collects `<style>` and nothing else — while a body
  // script rode through verbatim, which was coherent in neither direction.
  // One rule now, applied to the body as well.
  //
  // `<style>` is deliberately NOT removed anywhere: styling is not
  // execution, and it is self-contained. A stylesheet LINK is, because only
  // images are inlined — the exported file would point at a stylesheet that
  // is not sitting beside it.
  //
  // Known limit, recorded rather than quietly half-done: this removes script
  // ELEMENTS. Inline `on*` handler attributes and `javascript:` URLs in the
  // source survive, so "never executes" is a statement about `<script>`, not
  // a security boundary.
  parsed.body?.querySelectorAll('script, link[rel~="stylesheet" i]')
    .forEach((el) => el.remove());

  return { body: parsed.body?.innerHTML ?? '', head };
}
