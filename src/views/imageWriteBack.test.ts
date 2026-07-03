// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { toLiveHtml } from './htmlModel';
import { htmlSchema } from './htmlSchema';
import { dirtyTrackingPlugin, getDirtyBlockIds } from './dirtyTracking';
import { blockIdentityPlugin } from './blockIdentity';
import { toSource } from './ViewSync';
import { serializeHtmlDirty } from './htmlSerializer';
import { insertImage } from '../commands/htmlInlineCommands';

describe('HTML image insert write-back (no-beautify)', () => {
  it('inserting an image writes a verbatim relative src; rest byte-identical', () => {
    const source = '<!doctype html>\n<html>\n<body>\n<p>alpha</p>\n<p>beta</p>\n</body>\n</html>\n';
    const res = toLiveHtml(source);
    if (!res.ok) throw new Error('degraded');
    let state = EditorState.create({
      doc: res.doc, schema: htmlSchema,
      plugins: [dirtyTrackingPlugin(), blockIdentityPlugin()],
    });
    // cursor at end of block 0 ("alpha")
    const end = res.doc.child(0).nodeSize - 1;
    state = state.apply(state.tr.setSelection(TextSelection.near(res.doc.resolve(end))));
    insertImage('img/a.png', 'cap', 'asset://x/a.png')(state, (tr) => { state = state.apply(tr); });

    const dirty = getDirtyBlockIds(state);
    expect(dirty.size).toBe(1);

    const out = toSource(state.doc, source, serializeHtmlDirty(dirty));
    expect(out).toContain('src="img/a.png"'); // verbatim relative path
    expect(out).not.toContain('asset://');     // displaySrc never serialized
    expect(out).toContain('<p>beta</p>');       // untouched block survives
    expect(out.startsWith('<!doctype html>\n')).toBe(true);
  });
});
