// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted by Vitest to the top of the file, BEFORE any import below is
// evaluated — unlike `vi.doMock`, which only affects imports that happen
// AFTER it runs and so cannot retroactively intercept a module already
// pulled in by a static `import`. This is what makes the "no write path"
// test below able to actually fail: every module `buildExport` imports
// (transitively or not) sees this mock, not the real Tauri bridge.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => p),
}));

import { invoke } from '@tauri-apps/api/core';
import { toLive } from '../views/ViewSync';
import { buildExport } from './buildExport';

const SOURCE = '# Title\n\nA  paragraph   with  odd   spacing.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.mocked(invoke).mockClear();
});

describe('export never touches the source', () => {
  it('leaves the source string byte-identical', async () => {
    // NOTE ON VACUITY: this assertion cannot fail under any implementation of
    // buildExport. `SOURCE` is a JS string primitive passed BY VALUE into
    // `input.source`; no function can reach back and mutate the outer
    // `const` binding, so `expect(SOURCE).toBe(before)` is true even for a
    // pathological buildExport that reassigns `input.source` internally.
    // Kept anyway (it documents the intended guarantee and costs nothing),
    // but per the task's instruction not to leave an unfalsifiable test
    // standing unaccompanied, the two tests below assert the same guarantee
    // in ways that CAN fail: one on the real risk (a write path is reached),
    // one on the near-miss (markdown export quietly reading `source`
    // instead of the live `doc`, which would show up as stale content).
    const before = SOURCE;
    const r = toLive(SOURCE, null);
    if (!r.ok) throw new Error('fixture failed');
    const { html } = await buildExport({
      format: 'markdown', doc: r.doc, source: SOURCE, title: 't', resolve: () => null,
    });
    expect(html.length).toBeGreaterThan(0); // the pipeline really ran
    expect(SOURCE).toBe(before);
  });

  it('renders the CURRENT doc, never a stale source string', async () => {
    // The real near-miss the test above can't catch: if Markdown export ever
    // read `input.source` instead of `input.doc`, an unsaved live edit would
    // silently export the file's last-saved bytes instead of what's on
    // screen. `source` here is deliberately the ORIGINAL text while `doc` is
    // built from DIFFERENT text, so a source-reading bug renders "Title"
    // (wrong) and a doc-reading implementation renders "Renamed" (right).
    const edited = toLive('# Renamed\n\nBody text.\n', null);
    if (!edited.ok) throw new Error('fixture failed');
    const { html } = await buildExport({
      format: 'markdown', doc: edited.doc, source: SOURCE, title: 't', resolve: () => null,
    });
    expect(html).toContain('Renamed');
    expect(html).not.toContain('Title');
  });

  it('writes through NO file-writing path at all', async () => {
    // Stronger than the string check: prove the module graph never reaches a
    // writer. If export ever gains a write, this fails and forces the author
    // to justify it.
    const r = toLive(SOURCE, null);
    if (!r.ok) throw new Error('fixture failed');
    await buildExport({
      format: 'markdown', doc: r.doc, source: SOURCE, title: 't', resolve: () => null,
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
