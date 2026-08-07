// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { joinBackward } from 'prosemirror-commands';
import { buildLiveDoc } from './liveModel';
import { liveSchema } from './liveSchema';
import { dirtyTrackingPlugin } from './dirtyTracking';
import { blockIdentityPlugin } from './blockIdentity';
import { LiveView } from './LiveView';
import { splitCommand, softBreakCommand } from '../commands/markdownStructureCommands';

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

  it('installs find highlighting in both editable and read-only views', async () => {
    for (const editable of [true, false]) {
      const seen: Array<unknown> = [];
      const c = document.createElement('div');
      document.body.appendChild(c);
      const root = createRoot(c);
      await act(async () => root.render(
        <LiveView doc={docFor('hello world\n')} editable={editable} onViewReady={(v) => { if (v) seen.push(v); }} />,
      ));
      const view = seen[0] as { state: { plugins: Array<{ spec: { key?: unknown } }> } };
      const hasFind = view.state.plugins.some((p) => String((p as { key?: string }).key ?? '').includes('edtrFind'));
      expect(hasFind, `editable=${editable}`).toBe(true);
      await act(async () => root.unmount());
      c.remove();
    }
  });
});

function editState(src: string) {
  const r = buildLiveDoc(src);
  if (!r.ok) throw new Error('degraded');
  return EditorState.create({ doc: r.doc, schema: liveSchema, plugins: [blockIdentityPlugin(), dirtyTrackingPlugin()] });
}
function cursor(s: EditorState, index: number, offset = 1) {
  let pos = 0; for (let i = 0; i < index; i++) pos += s.doc.child(i).nodeSize;
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos + offset)));
}
function run(s: EditorState, cmd: (st: EditorState, d?: (tr: any) => void) => boolean) {
  let next = s; cmd(s, (tr) => { next = s.apply(tr); }); return next;
}

describe('LiveView structural editing (lock removed)', () => {
  it('Enter splits a top-level paragraph into two', () => {
    let s = cursor(editState('onetwo\n'), 0, 4);
    s = run(s, splitCommand);
    expect(s.doc.childCount).toBe(2);
  });
  it('Shift-Enter inserts a hard break without splitting', () => {
    let s = cursor(editState('onetwo\n'), 0, 4);
    s = run(s, softBreakCommand);
    expect(s.doc.childCount).toBe(1);
  });
  it('Backspace at block start merges into the previous block', () => {
    let s = editState('one\n\ntwo\n');
    // cursor at start of the second block
    const start = s.doc.child(0).nodeSize + 1;
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, start)));
    s = run(s, joinBackward);
    expect(s.doc.childCount).toBe(1);
    expect(s.doc.child(0).textContent).toBe('onetwo');
  });
});
