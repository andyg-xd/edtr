import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { saveSession } from './fileController';
import { DocumentSession } from './documentSession';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

const META = { eol: 'lf' as const, hadBom: false };
const PATH = '/docs/notes.md';

/** Disk holds `onDisk` (or nothing, when null); every write is recorded. */
function disk(onDisk: string | null) {
  const writes: string[] = [];
  vi.mocked(invoke).mockImplementation(async (cmd, args) => {
    const a = args as { text?: string };
    if (cmd === 'read_text_file') {
      if (onDisk === null) throw new Error('No such file or directory');
      return { text: onDisk, meta: META };
    }
    if (cmd === 'write_text_file_atomic') { writes.push(a.text!); return undefined; }
    throw new Error(`unexpected command ${cmd}`);
  });
  return writes;
}

function editedSession(): DocumentSession {
  const s = new DocumentSession({ path: PATH, text: 'original\n', meta: META, format: 'markdown' });
  s.setCurrentText('original\nmine\n');
  return s;
}

describe('saveSession — never overwrites changes it has not seen', () => {
  beforeEach(() => { vi.mocked(invoke).mockReset(); });

  it('saves without asking when the file is as this window last saw it', async () => {
    const writes = disk('original\n');
    const confirm = vi.fn();
    const s = editedSession();
    expect(await saveSession(s, confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(writes).toEqual(['original\nmine\n']);
    expect(s.isDirty()).toBe(false);
  });

  it('asks before writing when another app or window changed the file', async () => {
    const writes = disk('original\ntheirs\n');
    const confirm = vi.fn().mockResolvedValue(false);
    const s = editedSession();
    expect(await saveSession(s, confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(PATH);
    expect(writes).toEqual([]);
    expect(s.isDirty()).toBe(true);
  });

  it('writes when the person chooses to overwrite', async () => {
    const writes = disk('original\ntheirs\n');
    const s = editedSession();
    expect(await saveSession(s, vi.fn().mockResolvedValue(true))).toBe(true);
    expect(writes).toEqual(['original\nmine\n']);
    expect(s.isDirty()).toBe(false);
  });

  it('a file that is gone is saved again without asking — there is nothing on disk to lose', async () => {
    const writes = disk(null);
    const confirm = vi.fn();
    expect(await saveSession(editedSession(), confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(writes).toEqual(['original\nmine\n']);
  });

  it('after its own save, the next save does not ask', async () => {
    const s = editedSession();
    disk('original\n');
    await saveSession(s, vi.fn());
    s.setCurrentText('original\nmine\nmore\n');
    disk('original\nmine\n');
    const confirm = vi.fn();
    expect(await saveSession(s, confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});
