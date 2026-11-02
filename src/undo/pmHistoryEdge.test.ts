// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { EditorState, Plugin, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { liveSchema as schema } from '../views/liveSchema';
import { pmHistoryEdgePlugin } from './pmHistoryEdge';
import type { HistoryEdge } from './historyEdge';

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; document.body.innerHTML = ''; });

/** A Live-like editor: the edge plugin ahead of history and its own ⌘Z keymap,
 * in the order both Live views use. */
function mount(edge: HistoryEdge, after: Plugin[] = []) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const doc = schema.node('doc', null, [schema.node('paragraph', { blockId: 'b0' }, [schema.text('hello')])]);
  view = new EditorView(host, {
    state: EditorState.create({
      doc,
      plugins: [
        pmHistoryEdgePlugin(() => edge),
        ...after,
        history(),
        keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo }),
      ],
    }),
  });
  return view;
}

function type(v: EditorView, text: string) {
  const end = v.state.doc.content.size - 1;
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, end)).insertText(text));
}

// jsdom reports no Mac platform, so ProseMirror's "Mod" is Control here; in
// WKWebView it is ⌘. The binding is the same either way.
const key = (v: EditorView, k: string, shift = false) => {
  // keyCode too: both editors use it to match Shift+letter, and a real
  // keyboard always sends one.
  const keyCode = k.toUpperCase().charCodeAt(0);
  const e = new KeyboardEvent('keydown', { key: k, keyCode, ctrlKey: true, shiftKey: shift, bubbles: true, cancelable: true });
  v.dom.dispatchEvent(e);
  return e;
};
const input = (v: EditorView, inputType: string) => {
  const e = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
  v.dom.dispatchEvent(e);
  return e;
};

describe('pmHistoryEdgePlugin', () => {
  it('⌘Z with nothing left in the editor takes the whole-view step', () => {
    const edge = vi.fn(() => true);
    const v = mount(edge);
    const e = key(v, 'z');
    expect(edge).toHaveBeenCalledWith('undo');
    expect(e.defaultPrevented).toBe(true);
  });

  it("⌘Z uses the editor's own steps first", () => {
    const edge = vi.fn(() => true);
    const v = mount(edge);
    type(v, ' world');
    key(v, 'z');
    expect(edge).not.toHaveBeenCalled();
    expect(v.state.doc.textContent).toBe('hello');
  });

  it('the menu Undo (beforeinput historyUndo) takes the same path', () => {
    const edge = vi.fn(() => true);
    const v = mount(edge);
    const e = input(v, 'historyUndo');
    expect(edge).toHaveBeenCalledWith('undo');
    expect(e.defaultPrevented).toBe(true);
  });

  it("the menu Undo also uses the editor's own steps first", () => {
    const edge = vi.fn(() => true);
    const v = mount(edge);
    type(v, ' world');
    input(v, 'historyUndo');
    expect(edge).not.toHaveBeenCalled();
    expect(v.state.doc.textContent).toBe('hello');
  });

  it('⇧⌘Z, ⌘Y and the menu Redo take the redo step once the editor has none', () => {
    const edge = vi.fn(() => true);
    const v = mount(edge);
    key(v, 'Z', true); // a real keyboard sends the shifted character
    key(v, 'y');
    input(v, 'historyRedo');
    expect(edge.mock.calls).toEqual([['redo'], ['redo'], ['redo']]);
  });

  it('when there is no whole-view step, the event goes on to the editor as before', () => {
    const edge = vi.fn(() => false);
    // A plugin listed after the edge only runs if the edge passed the event on
    // (ProseMirror stops at the first handler that returns true).
    const seen = vi.fn(() => false);
    const v = mount(edge, [new Plugin({ props: { handleDOMEvents: { beforeinput: seen } } })]);
    input(v, 'historyUndo');
    expect(edge).toHaveBeenCalledWith('undo');
    expect(seen).toHaveBeenCalled();
    expect(v.state.doc.textContent).toBe('hello');
  });
});
