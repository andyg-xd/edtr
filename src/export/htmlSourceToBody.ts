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
  return { body: parsed.body?.innerHTML ?? '', head };
}
