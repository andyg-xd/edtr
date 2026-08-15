import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { buildExport, type ExportInput } from './buildExport';

/**
 * I/O only — all rendering lives in `buildExport`.
 *
 * No `deps` injection here, deliberately: `fileController.ts` calls `save`
 * and `invoke` directly rather than through an injected seam, so this
 * follows that convention rather than introducing a second I/O-boundary
 * style for the one new command. `exportController.test.ts` gets the same
 * coverage by mocking the three modules this function touches (`buildExport`,
 * `@tauri-apps/plugin-dialog`, `@tauri-apps/api/core`) — the cancel-vs-write
 * branch and the exact write payload are covered there, even though the
 * modules aren't injected.
 *
 * `save`'s return is written verbatim, extension and all — the user chose
 * the file name in the native panel, so nothing here second-guesses it.
 */
export async function exportAsHtml(
  input: ExportInput,
  defaultPath: string,
): Promise<{ status: 'written' | 'cancelled'; failures: string[] }> {
  const { html, failures } = await buildExport(input);
  const target = await save({
    defaultPath,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (!target) return { status: 'cancelled', failures };
  await invoke('write_text_file_atomic', {
    path: target, text: html, meta: { eol: 'lf', hadBom: false },
  });
  return { status: 'written', failures };
}
