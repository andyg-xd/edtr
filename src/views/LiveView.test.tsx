// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { buildLiveDoc } from './liveModel';
import { liveSchema } from './liveSchema';
import { LiveView, structureLockPlugin } from './LiveView';
import { setHeading } from '../commands/markdownBlockCommands';

let container: HTMLDivElement | null = null;
afterEach(() => {
  container?.remove();
  container = null;
});

async function render(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return container;
}

function docFor(src: string) {
  const r = buildLiveDoc(src);
  if (!r.ok) throw new Error('degraded');
  return r.doc;
}

describe('LiveView', () => {
  it('renders the projected markdown', async () => {
    const el = await render(<LiveView doc={docFor('# Hello\n\nWorld\n')} />);
    expect(el.querySelector('h1')?.textContent).toBe('Hello');
    expect(el.querySelector('p')?.textContent).toBe('World');
  });

  it('is editable by default in 3b', async () => {
    const el = await render(<LiveView doc={docFor('# Hello\n')} />);
    expect(el.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('true');
  });

  it('can be mounted read-only', async () => {
    const el = await render(<LiveView doc={docFor('# Hello\n')} editable={false} />);
    expect(el.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false');
  });

  it('reports the EditorView on mount and null on unmount', async () => {
    const onViewReady = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<LiveView doc={docFor('hi\n')} onViewReady={onViewReady} />));
    expect(onViewReady).toHaveBeenCalledTimes(1);
    expect(onViewReady.mock.calls[0][0]).not.toBeNull();
    await act(async () => root.unmount());
    expect(onViewReady).toHaveBeenLastCalledWith(null);
  });

  it('fires onStateChange on a selection-only change (no doc change)', async () => {
    const onStateChange = vi.fn();
    let captured: EditorView | null = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(<LiveView doc={docFor('hello world\n')} onViewReady={(v) => { captured = v; }} onStateChange={onStateChange} />),
    );
    const before = onStateChange.mock.calls.length;
    await act(async () => {
      const view = captured!;
      const sel = view.state.tr.setSelection(
        // move the cursor; selection-only, no doc change
        (view.state.selection.constructor as any).near(view.state.doc.resolve(3)),
      );
      view.dispatch(sel);
    });
    expect(onStateChange.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('structureLockPlugin', () => {
  it('rejects a transaction that changes the top-level block count', () => {
    const doc = docFor('alpha\n\nbeta\n'); // two top-level paragraphs
    expect(doc.childCount).toBe(2); // sanity
    const state = EditorState.create({ doc, schema: liveSchema, plugins: [structureLockPlugin()] });
    // delete across the boundary between the two paragraphs (would merge → 1 block)
    const tr = state.tr.delete(doc.child(0).nodeSize - 1, doc.child(0).nodeSize + 1);
    const after = state.apply(tr);
    expect(after.doc.childCount).toBe(2); // lock fired → structure unchanged
  });

  it('allows an intra-block text insertion', () => {
    const doc = docFor('alpha\n');
    const state = EditorState.create({ doc, schema: liveSchema, plugins: [structureLockPlugin()] });
    const after = state.apply(state.tr.insertText('X', 1));
    expect(after.doc.childCount).toBe(1);          // structure unchanged
    expect(after.doc.textContent).toBe('Xalpha');  // but the text WAS applied
  });

  it('structureLockPlugin permits a BLOCK_TRANSFORM-tagged structural tx and rejects an untagged one', () => {
    const state = EditorState.create({ doc: docFor('hello\n\nworld\n'), schema: liveSchema, plugins: [structureLockPlugin()] });
    const inFirst = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 1)));
    // tagged: setHeading sets the meta → should apply and change block 0 to a heading
    let tagged = inFirst;
    setHeading(2)(inFirst, (tr) => { tagged = inFirst.apply(tr); });
    expect(tagged.doc.child(0).type.name).toBe('heading');
    // untagged structural tx (same markup change, no meta) → filtered out (doc unchanged)
    const pos = inFirst.selection.$from.before(1);
    const b = inFirst.doc.child(0);
    const untagged = inFirst.apply(
      inFirst.tr.setNodeMarkup(pos, liveSchema.nodes.heading, { level: 2, srcFrom: b.attrs.srcFrom, srcTo: b.attrs.srcTo, blockId: b.attrs.blockId }),
    );
    expect(untagged.doc.child(0).type.name).toBe('paragraph'); // rejected by filterTransaction
  });
});
