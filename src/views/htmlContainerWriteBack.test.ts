// @vitest-environment jsdom
// src/views/htmlContainerWriteBack.test.ts
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { toLiveHtml } from './htmlModel';
import { htmlSchema } from './htmlSchema';
import { dirtyTrackingPlugin, getDirtyBlockIds } from './dirtyTracking';
import { blockIdentityPlugin } from './blockIdentity';
import { htmlWriteBack } from './ViewSync';

function editable(src: string) {
  const r = toLiveHtml(src);
  if (!r.ok) throw new Error('degraded');
  const state = EditorState.create({
    doc: r.doc, schema: htmlSchema,
    plugins: [dirtyTrackingPlugin(), blockIdentityPlugin()],
  });
  return { state, baselineDoc: r.doc };
}
// Type text at the given absolute position (inside a container's child).
function typeAt(state: EditorState, pos: number, text: string): EditorState {
  let s = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos))));
  return s.apply(s.tr.insertText(text, s.selection.from));
}

describe('HTML container write-back (no-beautify)', () => {
  it('an untouched container is byte-identical (hand-formatting preserved)', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<section class="a">\n  <p>one</p>\n  <p>two</p>\n</section>\n<p>tail</p>\n</body>\n</html>\n';
    const { state, baselineDoc } = editable(src);
    expect(htmlWriteBack(state.doc, src, getDirtyBlockIds(state), baselineDoc)).toBe(src);
  });

  it('editing inside a container re-serializes only that container; the sibling is byte-identical', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<section class="a">\n  <p>one</p>\n</section>\n<p>tail</p>\n</body>\n</html>\n';
    let { state, baselineDoc } = editable(src);
    // position 2 is inside the section's first paragraph ("one"): section open(1)->1, p open->2, text at ~3
    state = typeAt(state, 4, 'X'); // insert into "one" → "onXe" or similar; exact spot not important
    const out = htmlWriteBack(state.doc, src, getDirtyBlockIds(state), baselineDoc);
    expect(out).toContain('<section class="a">'); // class preserved
    expect(out).toContain('X');                    // edit present
    expect(out).toContain('</section>\n<p>tail</p>'); // untouched sibling byte-identical
    expect(out.endsWith('</body>\n</html>\n')).toBe(true);
  });

  it('editing a mixed <div> wraps loose text as <p> in the re-serialized block; sibling byte-identical', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<div>text<p>a</p></div>\n<p>tail</p>\n</body>\n</html>\n';
    let { state, baselineDoc } = editable(src);
    state = typeAt(state, 3, 'Z'); // into the wrapped "text" paragraph
    const out = htmlWriteBack(state.doc, src, getDirtyBlockIds(state), baselineDoc);
    expect(out).toContain('<div><p>'); // loose text now wrapped in <p> (edited=canonical)
    expect(out).toContain('<p>a</p></div>');
    expect(out).toContain('</div>\n<p>tail</p>'); // untouched sibling byte-identical
  });

  it('no-op with a mixed div + bare-inline blockquote present is byte-identical', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<div>hi<p>a</p></div>\n<blockquote>quote</blockquote>\n</body>\n</html>\n';
    const { state, baselineDoc } = editable(src);
    expect(htmlWriteBack(state.doc, src, getDirtyBlockIds(state), baselineDoc)).toBe(src);
  });
});
