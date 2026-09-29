import { describe, it, expect, vi, beforeEach } from 'vitest';

const openUrl = vi.fn();
const pathExists = vi.fn();
const openInNewWindow = vi.fn();
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (...a: unknown[]) => openUrl(...a) }));
vi.mock('../files/fileIo', () => ({ pathExists: (...a: unknown[]) => pathExists(...a) }));
vi.mock('../files/fileController', () => ({ openInNewWindow: (...a: unknown[]) => openInNewWindow(...a) }));

const { openLink } = await import('./openLink');

const DOC = '/Users/me/docs/plan.md';

beforeEach(() => {
  openUrl.mockReset().mockResolvedValue(undefined);
  pathExists.mockReset().mockResolvedValue(true);
  openInNewWindow.mockReset().mockResolvedValue(undefined);
});

function nothingOpened() {
  expect(openUrl).not.toHaveBeenCalled();
  expect(openInNewWindow).not.toHaveBeenCalled();
}

describe('openLink', () => {
  it('hands a web link to the default browser and says nothing', async () => {
    expect(await openLink('https://example.com', DOC)).toBeNull();
    expect(openUrl).toHaveBeenCalledWith('https://example.com');
    expect(openInNewWindow).not.toHaveBeenCalled();
  });

  it('opens a linked file that exists in a new Edtr window', async () => {
    expect(await openLink('./notes.md', DOC)).toBeNull();
    expect(pathExists).toHaveBeenCalledWith('/Users/me/docs/notes.md');
    expect(openInNewWindow).toHaveBeenCalledWith({ kind: 'files', paths: ['/Users/me/docs/notes.md'] });
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('names a linked file that is missing, and opens nothing', async () => {
    pathExists.mockResolvedValue(false);
    expect(await openLink('./gone.md', DOC)).toBe("Edtr couldn't find the linked file, gone.md.");
    nothingOpened();
  });

  it('explains a section link instead of opening it', async () => {
    expect(await openLink('#features', DOC)).toMatch(/section/);
    nothingOpened();
  });

  it('refuses a script link', async () => {
    expect(await openLink('javascript:alert(1)', DOC)).toMatch(/web, email/);
    nothingOpened();
  });

  it('refuses a file type Edtr does not edit', async () => {
    expect(await openLink('run.command', DOC)).toMatch(/Markdown, HTML and text/);
    nothingOpened();
  });

  it('asks for a save before following a relative link from an unsaved document', async () => {
    expect(await openLink('notes.md', null)).toMatch(/Save this file first/);
    nothingOpened();
  });

  it('reports a browser hand-off that fails, rather than failing silently', async () => {
    openUrl.mockRejectedValue(new Error('not allowed'));
    expect(await openLink('https://example.com', DOC)).toBe("Edtr couldn't open that link. Error: not allowed");
  });
});
