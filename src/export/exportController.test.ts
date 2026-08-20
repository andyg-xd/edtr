// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted (same reason as noBeautify.test.ts): `vi.doMock` after the static
// `import { exportAsHtml } from './exportController'` below would be too
// late to affect the module graph that import already resolved. `vi.mock`'s
// factory runs before this file's own `const`s do, so the mocks it returns
// must themselves be declared inside `vi.hoisted` to exist in time.
const { mockBuildExport, mockSave, mockInvoke } = vi.hoisted(() => ({
  mockBuildExport: vi.fn(),
  mockSave: vi.fn(),
  mockInvoke: vi.fn(),
}));
vi.mock('./buildExport', () => ({ buildExport: mockBuildExport }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mockSave }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

import { exportAsHtml, exportAsPdf } from './exportController';
import type { ExportInput } from './buildExport';

const INPUT: ExportInput = {
  format: 'markdown', doc: null, source: '', title: 't', resolve: () => null,
};

beforeEach(() => {
  mockBuildExport.mockReset();
  mockSave.mockReset();
  mockInvoke.mockReset();
});

describe('exportAsHtml', () => {
  it('cancels without writing when the save panel is dismissed', async () => {
    // The important direction: a broken cancel check means an export
    // silently writes a file the user just declined to create.
    mockBuildExport.mockResolvedValue({ html: '<html>x</html>', failures: ['a.png'] });
    mockSave.mockResolvedValue(null);
    const result = await exportAsHtml(INPUT, 'Notes.html');
    expect(result).toEqual({ status: 'cancelled', failures: ['a.png'] });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('writes exactly the built html to exactly the dialog-chosen path', async () => {
    mockBuildExport.mockResolvedValue({ html: '<html>real</html>', failures: [] });
    mockSave.mockResolvedValue('/Users/andy/Documents/exported-notes.html');
    const result = await exportAsHtml(INPUT, 'Notes.html');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('write_text_file_atomic', {
      path: '/Users/andy/Documents/exported-notes.html',
      text: '<html>real</html>',
      meta: { eol: 'lf', hadBom: false },
    });
    expect(result).toEqual({ status: 'written', failures: [] });
  });

  it('writes to the path the dialog returned, never the suggested defaultPath', async () => {
    // `defaultPath` is only a SUGGESTION for the native panel — the user can
    // rename or relocate it there. Using `defaultPath` instead of save()'s
    // return would silently write to the wrong file whenever they do.
    mockBuildExport.mockResolvedValue({ html: '<html>y</html>', failures: [] });
    mockSave.mockResolvedValue('/somewhere/else/renamed.html');
    await exportAsHtml(INPUT, 'Notes.html');
    const payload = mockInvoke.mock.calls[0][1] as { path: string };
    expect(payload.path).toBe('/somewhere/else/renamed.html');
    expect(payload.path).not.toBe('Notes.html');
  });
});

describe('exportAsPdf', () => {
  it('hands the built document to the print pipeline and nothing else', async () => {
    mockBuildExport.mockResolvedValue({ html: '<html>printable</html>', failures: [] });
    const result = await exportAsPdf(INPUT);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('print_html', { html: '<html>printable</html>' });
    expect(result).toEqual({ failures: [] });
  });

  it('never opens a save panel', async () => {
    // The distinction between the two kinds. macOS's print panel is where the
    // user chooses "Save as PDF" and picks a location, so a save panel here
    // would ask them for a path twice and then not use the first one.
    mockBuildExport.mockResolvedValue({ html: '<html>x</html>', failures: [] });
    await exportAsPdf(INPUT);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('reports the same image failures the HTML path reports', async () => {
    // The failures are a property of BUILDING the document, not of writing it,
    // so a PDF is exactly as affected by a missing image as an HTML export.
    mockBuildExport.mockResolvedValue({ html: '<html>x</html>', failures: ['pics/a.png'] });
    const result = await exportAsPdf(INPUT);
    expect(result.failures).toEqual(['pics/a.png']);
  });

  it('lets a failed print reject rather than reporting success', async () => {
    // `EditorWindow` catches this and raises the export error banner. Swallowing
    // it would leave the user believing a PDF is on its way when no print
    // window ever opened.
    mockBuildExport.mockResolvedValue({ html: '<html>x</html>', failures: [] });
    mockInvoke.mockRejectedValue('Could not open the print view: bad label');
    await expect(exportAsPdf(INPUT)).rejects.toBe('Could not open the print view: bad label');
  });
});
