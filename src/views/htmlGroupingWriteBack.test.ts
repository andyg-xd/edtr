// @vitest-environment jsdom
// src/views/htmlGroupingWriteBack.test.ts
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { toLiveHtml } from './htmlModel';
import { htmlSchema } from './htmlSchema';
import { dirtyTrackingPlugin, getDirtyBlockIds } from './dirtyTracking';
import { blockIdentityPlugin } from './blockIdentity';
import { htmlWriteBack } from './ViewSync';
import {
  toggleBlockquote, toggleBulletList, toggleOrderedList, sinkListItemCmd, liftListItemCmd,
} from '../commands/htmlBlockCommands';

function editable(src: string) {
  const r = toLiveHtml(src);
  if (!r.ok) throw new Error('degraded');
  const state = EditorState.create({
    doc: r.doc, schema: htmlSchema,
    plugins: [dirtyTrackingPlugin(), blockIdentityPlugin()],
  });
  return { state, baselineDoc: r.doc };
}
function cursorIn(state: EditorState, index: number): EditorState {
  let pos = 0; for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize;
  return state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos + 1))));
}
function selectAcross(state: EditorState, fromIdx: number, toIdx: number): EditorState {
  let a = 0; for (let i = 0; i < fromIdx; i++) a += state.doc.child(i).nodeSize;
  let b = 0; for (let i = 0; i < toIdx; i++) b += state.doc.child(i).nodeSize;
  return state.apply(state.tr.setSelection(
    TextSelection.between(state.doc.resolve(a + 1), state.doc.resolve(b + 1)),
  ));
}

describe('HTML grouping write-back (no-beautify)', () => {
  it('wrap one block → blockquote; the untouched neighbor is byte-identical', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<p>a</p>\n<p>b</p>\n</body>\n</html>\n';
    let { state, baselineDoc } = editable(src);
    state = cursorIn(state, 0);
    toggleBlockquote(state, (tr) => { state = state.apply(tr); });
    const out = htmlWriteBack(state.doc, src, getDirtyBlockIds(state), baselineDoc);
    expect(out).toContain('<blockquote><p>a</p></blockquote>\n<p>b</p>');
    expect(out.startsWith('<!doctype html>\n')).toBe(true);
    expect(out.endsWith('</body>\n</html>\n')).toBe(true);
  });

  it('group two blocks → ONE blockquote; edges byte-identical', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<p>a</p>\n<p>b</p>\n</body>\n</html>\n';
    let { state, baselineDoc } = editable(src);
    state = selectAcross(state, 0, 1);
    toggleBlockquote(state, (tr) => { state = state.apply(tr); });
    const out = htmlWriteBack(state.doc, src, getDirtyBlockIds(state), baselineDoc);
    expect(out).toContain('<blockquote><p>a</p><p>b</p></blockquote>');
    expect(out.startsWith('<!doctype html>\n')).toBe(true);
    expect(out.endsWith('</body>\n</html>\n')).toBe(true);
  });

  it('group two blocks → ONE bullet / ordered list', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<p>a</p>\n<p>b</p>\n</body>\n</html>\n';
    let ul = editable(src);
    let sUl = selectAcross(ul.state, 0, 1);
    toggleBulletList(sUl, (tr) => { sUl = sUl.apply(tr); });
    const outUl = htmlWriteBack(sUl.doc, src, getDirtyBlockIds(sUl), ul.baselineDoc);
    expect(outUl).toContain('<ul><li>a</li><li>b</li></ul>');

    let ol = editable(src);
    let sOl = selectAcross(ol.state, 0, 1);
    toggleOrderedList(sOl, (tr) => { sOl = sOl.apply(tr); });
    const outOl = htmlWriteBack(sOl.doc, src, getDirtyBlockIds(sOl), ol.baselineDoc);
    expect(outOl).toContain('<ol><li>a</li><li>b</li></ol>');
  });

  it('wrap → unwrap is byte-identity', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<p>a</p>\n<p>b</p>\n</body>\n</html>\n';
    let { state, baselineDoc } = editable(src);
    state = cursorIn(state, 0);
    toggleBlockquote(state, (tr) => { state = state.apply(tr); }); // wrap
    expect(state.doc.child(0).type.name).toBe('blockquote'); // the wrap actually fired
    // cursor is now inside the new blockquote (block 0) → toggle dissolves it
    state = cursorIn(state, 0);
    toggleBlockquote(state, (tr) => { state = state.apply(tr); }); // unwrap
    const out = htmlWriteBack(state.doc, src, getDirtyBlockIds(state), baselineDoc);
    expect(out).toBe(src);
  });

  it('sink (indent) nests a sublist; the untouched neighbor is byte-identical', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<p>tail</p>\n</body>\n</html>\n';
    let { state, baselineDoc } = editable(src);
    const list = state.doc.child(0);
    const secondItemInner = 1 + list.firstChild!.nodeSize + 1;
    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(secondItemInner))));
    sinkListItemCmd(state, (tr) => { state = state.apply(tr); });
    const out = htmlWriteBack(state.doc, src, getDirtyBlockIds(state), baselineDoc);
    // edited list re-serializes canonically with a nested sublist (edited=canonical)…
    expect(out).toContain('<ul><li><p>one</p><ul><li>two</li></ul></li></ul>');
    // …but the untouched top-level neighbor stays byte-identical — the invariant.
    expect(out).toContain('</ul>\n<p>tail</p>');
    expect(out.endsWith('</body>\n</html>\n')).toBe(true);
  });

  it('lift (outdent) after sink returns the list to a flat canonical form; neighbor byte-identical', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<p>tail</p>\n</body>\n</html>\n';
    let { state, baselineDoc } = editable(src);
    const list = state.doc.child(0);
    const secondItemInner = 1 + list.firstChild!.nodeSize + 1;
    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(secondItemInner))));
    sinkListItemCmd(state, (tr) => { state = state.apply(tr); });
    expect(state.doc.child(0).firstChild!.childCount).toBe(2); // the sink actually nested a sublist
    // re-place the cursor in the now-nested "two" item and lift it back out
    state = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(state.selection.from))));
    liftListItemCmd(state, (tr) => { state = state.apply(tr); });
    const out = htmlWriteBack(state.doc, src, getDirtyBlockIds(state), baselineDoc);
    // sink-then-lift is a perfect round trip in the PM doc tree, so dirty-tracking's
    // differs-from-baseline check (dirtyTracking.ts) correctly un-marks the block —
    // the write-back preserves the ORIGINAL bytes (including the source's own
    // newlines) rather than re-serializing canonically. Byte-identical to src.
    expect(out).toContain('<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
    expect(out).toContain('</ul>\n<p>tail</p>');
    expect(out).toBe(src);
  });

  it('no-op flush reproduces the source byte-for-byte', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<blockquote><p>q</p></blockquote>\n<ul><li>a</li></ul>\n</body>\n</html>\n';
    const { state, baselineDoc } = editable(src);
    expect(htmlWriteBack(state.doc, src, getDirtyBlockIds(state), baselineDoc)).toBe(src);
  });
});
