import { describe, it, expect, vi } from 'vitest';
import { openPayload, docToShow } from './openRouting';
import type { OpenPayload } from './openPayload';

const files = (...paths: string[]): OpenPayload => ({ kind: 'files', paths });

function deps(routed: OpenPayload | null) {
  return {
    route: vi.fn().mockResolvedValue(routed),
    apply: vi.fn().mockResolvedValue(undefined),
    spawn: vi.fn().mockResolvedValue(undefined),
  };
}

describe('openPayload — a file already open elsewhere is never opened again', () => {
  it('an empty window opens only what no other window has', async () => {
    const d = deps(files('/d/b.md'));
    await openPayload(files('/d/a.md', '/d/b.md'), true, d);
    expect(d.route).toHaveBeenCalledWith(files('/d/a.md', '/d/b.md'));
    expect(d.apply).toHaveBeenCalledWith(files('/d/b.md'));
    expect(d.spawn).not.toHaveBeenCalled();
  });

  it('an empty window opens nothing when every file is open elsewhere', async () => {
    const d = deps(null);
    await openPayload(files('/d/a.md'), true, d);
    expect(d.apply).not.toHaveBeenCalled();
    expect(d.spawn).not.toHaveBeenCalled();
  });

  it('a window with documents hands the whole payload to a new window, which routes it in Rust', async () => {
    const d = deps(null);
    await openPayload(files('/d/a.md'), false, d);
    expect(d.spawn).toHaveBeenCalledWith(files('/d/a.md'));
    expect(d.route).not.toHaveBeenCalled();
    expect(d.apply).not.toHaveBeenCalled();
  });
});

describe('docToShow — the window that has a file is asked to show it', () => {
  const docs = [{ id: '1', session: { path: '/d/a.md' } }, { id: '2', session: { path: '/d/b.md' } }];

  it('finds the document by the path this window registered', () => {
    expect(docToShow(docs, '/d/b.md')).toBe('2');
  });

  it('finds nothing for a file this window does not have', () => {
    expect(docToShow(docs, '/d/c.md')).toBeNull();
  });
});
