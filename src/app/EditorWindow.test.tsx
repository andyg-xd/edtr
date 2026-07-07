import { describe, it, expect, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { htmlSchema } from '../views/htmlSchema';
import { toLiveHtml } from '../views/htmlModel';
import { toSource, htmlWriteBack } from '../views/ViewSync';
import { serializeHtmlDirty } from '../views/htmlSerializer';
import { toLiveHtml as _toLiveHtml } from '../views/htmlModel';
import { htmlSchema as _htmlSchema } from '../views/htmlSchema';
import { isInTable as isHtmlInTable } from '../commands/htmlTableCommands';
import { isInTable as isMarkdownInTable } from '../commands/markdownTableCommands';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (p: string) => `asset://localhost${p}`,
  invoke: vi.fn(),
}));

// Exercises the retained toSource + serializeHtmlDirty primitive (still used by 4c golden tests).
// The adjacent htmlWriteBack round-trips test is the guard for what the HTML flush now uses.
describe('HTML flush wiring', () => {
  it('writes back only the dirty block, byte-identical elsewhere', () => {
    const SRC = `<html><body><h1>T</h1><p>old</p></body></html>`;
    const r = toLiveHtml(SRC);
    if (!r.ok) throw new Error(r.reason);
    const p = r.doc.child(1);
    const edited = htmlSchema.node('paragraph', p.attrs, [htmlSchema.text('new')]);
    const doc2 = htmlSchema.node('doc', null, [r.doc.child(0), edited]);
    const out = toSource(doc2, SRC, serializeHtmlDirty(new Set([p.attrs.blockId as string])));
    expect(out).toBe('<html><body><h1>T</h1><p>new</p></body></html>');
  });
});

// Contract: the HTML flush path reconstructs via htmlWriteBack. A structural
// change (a new top-level block whose id isn't in the baseline) round-trips
// with the untouched block byte-identical — which the old per-block splice
// could not express. (Full flow is GUI-validated; this pins the reconciler contract.)
it('htmlWriteBack round-trips a new block with untouched neighbors byte-identical', () => {
  const src = '<!doctype html>\n<html>\n<body>\n<p>keep</p>\n</body>\n</html>\n';
  const r = _toLiveHtml(src);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const added = _htmlSchema.node('paragraph', { htmlAttrs: {}, srcFrom: 0, srcTo: 0, blockId: 'new-0' }, [_htmlSchema.text('added')]);
  const doc = _htmlSchema.node('doc', null, [r.doc.child(0), added]);
  const out = htmlWriteBack(doc, src, new Set(['new-0']), r.doc);
  expect(out).toContain('<p>keep</p>\n<p>added</p>');
  expect(out.startsWith('<!doctype html>\n')).toBe(true);
});

// Wiring-contract: the HTML live-doc memo resolves images against the doc path.
// (Full drag-drop/paste behavior is GUI-validated — Tauri events/IPC aren't modeled in jsdom.)
describe('EditorWindow HTML image wiring', () => {
  it('toLiveHtml resolves image displaySrc when given a docPath (EditorWindow contract)', () => {
    // EditorWindow calls toLiveHtml(session.text, session.path). Prove the call shape
    // produces a resolvable displaySrc so a local <img> renders in the HTML Live view.
    const res = toLiveHtml('<html><body><p><img src="a.png"></p></body></html>', '/docs/n.html');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let img: any = null;
    res.doc.descendants((n: any) => { if (!img && n.type.name === 'image') img = n; });
    expect(img.attrs.htmlAttrs.src).toBe('a.png');
    expect(img.attrs.displaySrc).not.toBeNull();
  });
});

// Wiring-contract for the HTML contextual table toolbar (mounted in EditorWindow's
// HTML Live branch): the toolbar's visibility is gated on `isHtmlInTable` (from
// `htmlTableCommands`, schema-aware for `htmlSchema`). Using the Markdown
// `isInTable` (from `markdownTableCommands`, which walks `liveSchema.nodes.table` /
// `.tableCell`) instead would compile fine but never match an HTML doc's node
// types, silently hiding the toolbar forever. This pins that exact failure mode.
describe('EditorWindow HTML table-toolbar wiring (isHtmlInTable vs Markdown isInTable)', () => {
  function stateInCell() {
    const r = toLiveHtml('<html><body><table><tr><td>a</td></tr></table></body></html>');
    if (!r.ok) throw new Error(`degraded: ${r.reason}`);
    let at = -1;
    r.doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text?.includes('a')) at = pos;
    });
    if (at < 0) throw new Error('cell text not found');
    const state = EditorState.create({ doc: r.doc, schema: htmlSchema });
    return state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(at))));
  }

  it('isHtmlInTable detects the HTML table cell EditorWindow must show the toolbar for', () => {
    expect(isHtmlInTable(stateInCell())).toBe(true);
  });

  it('the Markdown isInTable never matches an HTML-schema doc — proves it would be the wrong predicate to wire into the HTML branch', () => {
    expect(isMarkdownInTable(stateInCell())).toBe(false);
  });

  it('isHtmlInTable is false outside a table (toolbar absent for a plain paragraph, matching the plain <p>-only HTML doc case)', () => {
    const r = toLiveHtml('<html><body><p>hi</p></body></html>');
    if (!r.ok) throw new Error(`degraded: ${r.reason}`);
    const state = EditorState.create({ doc: r.doc, schema: htmlSchema });
    expect(isHtmlInTable(state)).toBe(false);
  });
});
