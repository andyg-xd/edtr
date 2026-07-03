// @vitest-environment jsdom
// src/views/blockFormatWriteBack.test.ts
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { toLiveHtml } from './htmlModel';
import { htmlSchema } from './htmlSchema';
import { dirtyTrackingPlugin, getDirtyBlockIds } from './dirtyTracking';
import { htmlStructureLockPlugin } from './htmlStructureLock';
import { toSource } from './ViewSync';
import { serializeHtmlDirty } from './htmlSerializer';
import { setHeading } from '../commands/htmlBlockCommands';

describe('HTML block-format write-back (no-beautify)', () => {
  it("changing one block's type re-serializes only that block; rest byte-identical", () => {
    const source =
      '<!doctype html>\n<html>\n<head><style>p{color:red}</style></head>\n<body>\n<p>alpha</p>\n<p>beta</p>\n</body>\n</html>\n';
    const res = toLiveHtml(source);
    if (!res.ok) throw new Error('degraded');
    let state = EditorState.create({
      doc: res.doc, schema: htmlSchema,
      plugins: [dirtyTrackingPlugin(), htmlStructureLockPlugin()],
    });
    state = state.apply(state.tr.setSelection(TextSelection.near(res.doc.resolve(1)))); // block 0
    setHeading(2)(state, (tr) => { state = state.apply(tr); });

    const dirty = getDirtyBlockIds(state);
    expect(dirty.size).toBe(1);

    const out = toSource(state.doc, source, serializeHtmlDirty(dirty));
    expect(out).toContain('<h2>alpha</h2>');
    expect(out).not.toContain('<p>alpha</p>');
    expect(out).toContain('<p>beta</p>');                 // untouched block survives
    expect(out).toContain('<style>p{color:red}</style>'); // head verbatim
    expect(out.startsWith('<!doctype html>\n')).toBe(true);
    expect(out.endsWith('</body>\n</html>\n')).toBe(true);
  });
});
