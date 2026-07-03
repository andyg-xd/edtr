// @vitest-environment jsdom
// src/views/htmlStructuralWriteBack.test.ts
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { joinBackward } from 'prosemirror-commands';
import { toLiveHtml } from './htmlModel';
import { htmlSchema } from './htmlSchema';
import { dirtyTrackingPlugin, getDirtyBlockIds } from './dirtyTracking';
import { blockIdentityPlugin } from './blockIdentity';
import { htmlWriteBack } from './ViewSync';
import { splitCommand, insertHorizontalRule } from '../commands/htmlStructureCommands';

function editable(src: string) {
  const r = toLiveHtml(src);
  if (!r.ok) throw new Error('degraded');
  const state = EditorState.create({
    doc: r.doc, schema: htmlSchema,
    plugins: [dirtyTrackingPlugin(), blockIdentityPlugin()],
  });
  return { state, baselineDoc: r.doc };
}

describe('HTML structural write-back (no-beautify)', () => {
  it('split re-serializes only the touched region; the untouched block is byte-identical', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<p>alphabeta</p>\n<p>gamma</p>\n</body>\n</html>\n';
    let { state, baselineDoc } = editable(src);
    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(6)))); // after "alpha"
    splitCommand(state, (tr) => { state = state.apply(tr); });
    const out = htmlWriteBack(state.doc, src, getDirtyBlockIds(state), baselineDoc);
    expect(out).toContain('<p>alpha</p>\n<p>beta</p>\n<p>gamma</p>');
    expect(out.endsWith('</body>\n</html>\n')).toBe(true);
  });

  it('merge (joinBackward) collapses two blocks; the rest byte-identical', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<p>one</p>\n<p>two</p>\n<p>three</p>\n</body>\n</html>\n';
    let { state, baselineDoc } = editable(src);
    // cursor at the START of the second block ("two")
    const startOfTwo = state.doc.child(0).nodeSize + 1;
    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(startOfTwo))));
    joinBackward(state, (tr) => { state = state.apply(tr); });
    const out = htmlWriteBack(state.doc, src, getDirtyBlockIds(state), baselineDoc);
    expect(out).toContain('<p>onetwo</p>');
    expect(out).toContain('<p>three</p>'); // untouched tail survives
  });

  it('inserting <hr> writes it between blocks; neighbors byte-identical', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<p>a</p>\n<p>b</p>\n</body>\n</html>\n';
    let { state, baselineDoc } = editable(src);
    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(2)))); // in block 0
    insertHorizontalRule(state, (tr) => { state = state.apply(tr); });
    const out = htmlWriteBack(state.doc, src, getDirtyBlockIds(state), baselineDoc);
    expect(out).toContain('<hr>');
    expect(out).toContain('<p>b</p>'); // untouched block survives
    expect(out.startsWith('<!doctype html>\n')).toBe(true);
  });

  it('no-op flush reproduces the source byte-for-byte', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<p>x</p>\n<hr>\n<p>y</p>\n</body>\n</html>\n';
    const { state, baselineDoc } = editable(src);
    expect(htmlWriteBack(state.doc, src, getDirtyBlockIds(state), baselineDoc)).toBe(src);
  });
});
