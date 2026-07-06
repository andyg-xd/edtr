// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { toLiveHtml } from './htmlModel';
import { htmlSchema } from './htmlSchema';
import { dirtyTrackingPlugin, getDirtyBlockIds } from './dirtyTracking';
import { blockIdentityPlugin } from './blockIdentity';
import { htmlWriteBack } from './ViewSync';

function editable(src: string) {
  const r = toLiveHtml(src);
  if (!r.ok) throw new Error(`degraded: ${r.reason}`);
  const state = EditorState.create({
    doc: r.doc, schema: htmlSchema,
    plugins: [dirtyTrackingPlugin(), blockIdentityPlugin()],
  });
  return { state, baselineDoc: r.doc };
}
function posOfText(doc: any, needle: string): number {
  let at = -1;
  doc.descendants((n: any, pos: number) => {
    if (at < 0 && n.isText && typeof n.text === 'string' && n.text.includes(needle)) at = pos + n.text.indexOf(needle);
  });
  if (at < 0) throw new Error(`text not found: ${needle}`);
  return at;
}
function typeAt(state: EditorState, needle: string, text: string): EditorState {
  const s = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(posOfText(state.doc, needle)))));
  return s.apply(s.tr.insertText(text, s.selection.from));
}

describe('HTML table write-back (no-beautify)', () => {
  it('no-op round-trip is byte-identical (hand-formatting preserved)', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<table>\n  <tr>  <td>a</td>  <td>b</td>  </tr>\n</table>\n<p>tail</p>\n</body>\n</html>\n';
    const { state, baselineDoc } = editable(src);
    expect(htmlWriteBack(state.doc, src, getDirtyBlockIds(state), baselineDoc)).toBe(src);
  });

  it('editing a cell re-serializes only that table; the sibling is byte-identical', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<table><tr><td>one</td></tr></table>\n<p>tail</p>\n</body>\n</html>\n';
    const { state, baselineDoc } = editable(src);
    const edited = typeAt(state, 'one', 'X');
    const out = htmlWriteBack(edited.doc, src, getDirtyBlockIds(edited), baselineDoc);
    expect(out).toContain('X');                              // edit present
    expect(out).toContain('<tbody>');                        // edited table canonicalized
    expect(out).toContain('</table>\n<p>tail</p>');          // untouched sibling byte-identical
    expect(out.endsWith('</body>\n</html>\n')).toBe(true);
  });

  it('an untouched table is byte-identical while a sibling paragraph is edited', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<p>lead</p>\n<table>\n  <tr><td>keep</td></tr>\n</table>\n</body>\n</html>\n';
    const { state, baselineDoc } = editable(src);
    const edited = typeAt(state, 'lead', 'Z');
    const out = htmlWriteBack(edited.doc, src, getDirtyBlockIds(edited), baselineDoc);
    expect(out).toContain('Z');
    // the whole untouched table block (with its hand-padding) survives verbatim
    expect(out).toContain('<table>\n  <tr><td>keep</td></tr>\n</table>');
  });

  it('a spanned table stays verbatim and byte-identical on no-op', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<table><tr><td colspan="2">x</td></tr></table>\n<p>t</p>\n</body>\n</html>\n';
    const { state, baselineDoc } = editable(src);
    expect(htmlWriteBack(state.doc, src, getDirtyBlockIds(state), baselineDoc)).toBe(src);
  });

  it('editing a cell of a table nested in a container canonicalizes the container; the sibling is byte-identical', () => {
    const src = '<!doctype html>\n<html>\n<body>\n<section><table><tr><td>one</td></tr></table></section>\n<p>tail</p>\n</body>\n</html>\n';
    const { state, baselineDoc } = editable(src);
    const edited = typeAt(state, 'one', 'Y');
    const out = htmlWriteBack(edited.doc, src, getDirtyBlockIds(edited), baselineDoc);
    expect(out).toContain('Y');
    expect(out).toContain('</section>\n<p>tail</p>'); // untouched sibling byte-identical
  });
});
