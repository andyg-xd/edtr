import type { Node as PMNode } from 'prosemirror-model';
import { pmToHtml } from './pmToHtml';
import { htmlSourceToBody } from './htmlSourceToBody';
import { inlineAssets } from './inlineAssets';
import { documentShell } from './documentShell';

export interface ExportInput {
  format: 'markdown' | 'html';
  /** The live projection. Required for Markdown; unused for HTML (D4). */
  doc: PMNode | null;
  /** The file's own text. Required for HTML; unused for Markdown. */
  source: string;
  /** Shown as the document title — the file's name, without the extension. */
  title: string;
  resolve: (src: string) => string | null;
}

/**
 * The single artifact both outputs are made of (6c-iii): "Export as HTML"
 * writes this string, and "Export as PDF" prints it. They cannot drift.
 *
 * Pure by construction — no file path in, no Tauri import anywhere in this
 * module, so there is no way for it to reach a write command even by
 * accident. `noBeautify.test.ts` holds that structural guarantee to a
 * mocked-module proof rather than to a single call-site check.
 */
export async function buildExport(
  input: ExportInput,
): Promise<{ html: string; failures: string[] }> {
  const { body, head } = input.format === 'html'
    ? htmlSourceToBody(input.source)
    : { body: input.doc ? pmToHtml(input.doc) : '', head: '' };

  const inlined = await inlineAssets(body, input.resolve);
  return {
    html: documentShell({ title: input.title, body: inlined.html, extraHead: head }),
    failures: inlined.failures,
  };
}
