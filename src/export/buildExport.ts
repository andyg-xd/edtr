import type { Node as PMNode } from 'prosemirror-model';
import { pmToHtml } from './pmToHtml';
import { htmlSourceToBody } from './htmlSourceToBody';
import { inlineAssets } from './inlineAssets';
import { documentShell } from './documentShell';
import { plaintextToBody } from './plaintextToBody';
import { sanitizeHtml } from '../views/htmlSanitize';

export interface ExportInput {
  format: 'markdown' | 'html' | 'plaintext';
  /** The live projection. Required for Markdown; unused otherwise (D4). */
  doc: PMNode | null;
  /** The file's own text. Required for HTML and plaintext; unused for Markdown. */
  source: string;
  /** Shown as the document title — the file's name, without the extension. */
  title: string;
  resolve: (src: string) => string | null;
}

/**
 * The single artifact both outputs are made of (6c-iii): "Export as HTML"
 * writes this string, and "Export as PDF" prints it. They cannot drift, except
 * that the printed copy is built `inert` (see below).
 *
 * Pure by construction — no file path in, no Tauri import anywhere in this
 * module, so there is no way for it to reach a write command even by
 * accident. `noBeautify.test.ts` holds that structural guarantee to a
 * mocked-module proof rather than to a single call-site check.
 */
export async function buildExport(
  input: ExportInput,
  { inert = false }: { inert?: boolean } = {},
): Promise<{ html: string; failures: string[] }> {
  const { body: authored, head } = input.format === 'html'
    ? htmlSourceToBody(input.source)
    : input.format === 'plaintext'
      // No projection to read: a .txt has no Live view, and its text is not
      // markup. `plaintextToBody` escapes and preserves it verbatim.
      ? { body: plaintextToBody(input.source), head: '' }
      : { body: input.doc ? pmToHtml(input.doc) : '', head: '' };

  // `inert` is for the print window, which renders this inside Edtr. The
  // exported FILE keeps the author's markup as written — it runs in whoever
  // opens it, like any page — but a copy Edtr itself renders has no reason to
  // carry a page's handlers or `javascript:` links, so it goes through the same
  // sanitizer HTML Live uses. The one respect in which the two outputs differ.
  const body = inert ? sanitizeHtml(authored) : authored;
  const inlined = await inlineAssets(body, input.resolve);
  return {
    html: documentShell({ title: input.title, body: inlined.html, extraHead: head }),
    failures: inlined.failures,
  };
}
