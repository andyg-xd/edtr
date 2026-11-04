// @vitest-environment jsdom
//
// Wrapping is display-only (spec, "Wrapping is display-only"). Flipping a code
// block's label must not change a byte on save, mark a block changed, or add
// an undo step. This drives the real Markdown Live editor and the real
// `writeBack` path a save takes.
//
// The second test is what keeps the first honest: without proof that a real
// edit DOES reach the serializer and change the output, a write-back that
// returned its baseline for any reason would satisfy the first test.
import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { EditorView } from 'prosemirror-view';
import { undoDepth } from 'prosemirror-history';
import { buildLiveDoc } from '../views/liveModel';
import { LiveView } from '../views/LiveView';
import { writeBack } from '../views/ViewSync';
import { getDirtyBlockIds } from '../views/dirtyTracking';
import { detectFlavor } from '../doc/flavor';
import { blockWraps } from './codeWrapPlugin';

// A fenced block, an indented block, a block nested in a list item, and a
// diagram, with deliberately odd spacing a serializer would tidy away.
const SOURCE = [
  '# Title',
  '',
  '~~~~ts   title="x"',
  'const  a =   1;',
  '~~~~',
  '',
  '    indented   code',
  '      more',
  '',
  '*   item',
  '',
  '    ```',
  '    nested  block',
  '    ```',
  '',
  '```',
  '┌───┐',
  '│ a │',
  '└───┘',
  '```',
  '',
  'Trailing   paragraph.',
  '',
].join('\n');

let container: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

async function mount() {
  const r = buildLiveDoc(SOURCE);
  if (!r.ok) throw new Error(`fixture degraded: ${r.reason}`);
  const baselineDoc = r.doc;
  let view: EditorView | null = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(LiveView, {
    doc: r.doc,
    onViewReady: (v: EditorView | null) => { if (v) view = v; },
  })));
  return { view: view!, baselineDoc };
}

function codeBlockPositions(view: EditorView): number[] {
  const out: number[] = [];
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') out.push(pos);
    return true;
  });
  return out;
}

function save(view: EditorView, baselineDoc: import('prosemirror-model').Node): string {
  return writeBack(view.state.doc, SOURCE, getDirtyBlockIds(view.state), detectFlavor(SOURCE, 'markdown'), baselineDoc);
}

describe('flipping code blocks never touches the file', () => {
  it('toggling every block twice leaves the saved bytes identical, with nothing dirty and no undo step', async () => {
    const { view, baselineDoc } = await mount();
    const positions = codeBlockPositions(view);
    expect(positions).toHaveLength(4);
    const initial = positions.map((p) => blockWraps(view.state, p));
    expect(initial).toEqual([true, true, true, false]);

    const buttons = Array.from(container!.querySelectorAll<HTMLButtonElement>('.code-wrap-toggle'));
    expect(buttons).toHaveLength(4);

    for (let pass = 1; pass <= 2; pass++) {
      for (const button of buttons) await act(async () => { button.click(); });
      // Each flip really happened, so the byte check below is not vacuous.
      const expected = pass === 1 ? initial.map((w) => !w) : initial;
      expect(positions.map((p) => blockWraps(view.state, p)), `pass ${pass}`).toEqual(expected);
      expect(getDirtyBlockIds(view.state).size, `pass ${pass}: dirty blocks`).toBe(0);
      expect(undoDepth(view.state), `pass ${pass}: undo steps`).toBe(0);
      expect(save(view, baselineDoc), `pass ${pass}: saved bytes`).toBe(SOURCE);
    }
  });

  it('a real edit inside a code block DOES change the saved bytes (proves the test above is not vacuous)', async () => {
    const { view, baselineDoc } = await mount();
    const [fenced] = codeBlockPositions(view);
    await act(async () => { view.dispatch(view.state.tr.insertText('X', fenced + 1)); });
    expect(getDirtyBlockIds(view.state).size).toBeGreaterThan(0);
    const out = save(view, baselineDoc);
    expect(out).not.toBe(SOURCE);
    expect(out).toContain('Xconst  a =   1;');
    expect(out).toContain('    indented   code\n      more');
  });
});
