import { describe, it, expect } from 'vitest';
import { EditorState, AllSelection } from 'prosemirror-state';
import { toLiveHtml } from '../views/htmlModel';
import { toLive } from '../views/ViewSync';
import { htmlSchema } from '../views/htmlSchema';
import { liveSchema } from '../views/liveSchema';
import { htmlRibbon } from './htmlRibbon';
import { htmlTableRibbon } from './htmlTableRibbon';
import { markdownRibbon } from './markdownRibbon';
import { markdownTableRibbon } from './markdownTableRibbon';
import type { RibbonControl } from './RibbonModel';

// Regression: RibbonView evaluates isEnabled/isActive/getValue on EVERY render,
// including after ⌘A (native selectAll) which produces an AllSelection spanning
// the whole doc. A throw here is uncaught during render → the React tree
// unmounts → blank window (observed: ⌘A crashed the app). The block-insert
// commands used to read state.doc.child($to.index(0)) which is childCount (out
// of range) under an AllSelection. Every control must be safe on any selection.
function evalEveryControl(name: string, controls: RibbonControl[], state: EditorState) {
  for (const c of controls) {
    expect(() => {
      c.isEnabled(state);
      c.isActive(state);
      if (c.action.kind === 'dropdown') c.action.getValue(state);
    }, `${name} control '${c.id}' threw on AllSelection`).not.toThrow();
  }
}

describe('ribbon controls survive AllSelection (⌘A)', () => {
  it('HTML ribbon + table ribbon do not throw over a rich doc', () => {
    const SRC =
      '<html><body><h1>T</h1><p>hello</p><section><p>x</p></section>' +
      '<table><tr><th>a</th><th>b</th></tr><tr><td>c</td><td>d</td></tr></table>' +
      '</body></html>';
    const r = toLiveHtml(SRC);
    if (!r.ok) throw new Error(`degraded: ${r.reason}`);
    const state = EditorState.create({ doc: r.doc, schema: htmlSchema });
    const all = state.apply(state.tr.setSelection(new AllSelection(state.doc)));
    evalEveryControl('htmlRibbon', htmlRibbon, all);
    evalEveryControl('htmlTableRibbon', htmlTableRibbon, all);
  });

  it('Markdown ribbon + table ribbon do not throw over a rich doc', () => {
    const SRC = '# T\n\nhello\n\n| a | b |\n| - | - |\n| c | d |\n';
    const r = toLive(SRC, null);
    if (!r.ok) throw new Error(`degraded: ${r.reason}`);
    const state = EditorState.create({ doc: r.doc, schema: liveSchema });
    const all = state.apply(state.tr.setSelection(new AllSelection(state.doc)));
    evalEveryControl('markdownRibbon', markdownRibbon, all);
    evalEveryControl('markdownTableRibbon', markdownTableRibbon, all);
  });
});
