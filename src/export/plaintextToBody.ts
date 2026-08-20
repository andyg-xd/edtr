import { escapeHtml } from './escapeHtml';

/**
 * A plaintext document's exportable body (6c-iii, owner decision 2026-08-20).
 *
 * Wrapped in `<pre>` and escaped, which is the only faithful rendering: a
 * `.txt` file has no markup to interpret, so its spacing and line breaks ARE
 * its content. The rejected alternative was routing it through the Markdown
 * parser, which silently reinterprets the file — a leading `#` becomes a
 * heading, `*` becomes emphasis — and changes what the document says.
 *
 * The `plaintext` class exists so `exportStyles` can wrap long lines here
 * without touching the `<pre>` used for fenced code blocks in a Markdown
 * export, where horizontal scrolling is the wanted behaviour.
 */
export function plaintextToBody(source: string): string {
  return `<pre class="plaintext">${escapeHtml(source)}</pre>`;
}
