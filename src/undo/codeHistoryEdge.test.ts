// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { history, historyKeymap } from '@codemirror/commands';
import { codeHistoryEdge } from './codeHistoryEdge';
import type { HistoryEdge } from './historyEdge';

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; document.body.innerHTML = ''; });

/** Code view's history setup (`codeViewExtensions.ts`) with the edge added. */
function mount(edge: HistoryEdge, extra: Extension[] = []) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc: 'hello',
      extensions: [history(), keymap.of(historyKeymap), codeHistoryEdge(() => edge), ...extra],
    }),
  });
  return view;
}

const type = (v: EditorView, text: string) =>
  v.dispatch({ changes: { from: v.state.doc.length, insert: text }, userEvent: 'input.type' });

// jsdom reports no Mac platform, so CodeMirror's "Mod" is Control here.
const key = (v: EditorView, k: string, shift = false) => {
  // keyCode too: both editors use it to match Shift+letter, and a real
  // keyboard always sends one.
  const keyCode = k.toUpperCase().charCodeAt(0);
  const e = new KeyboardEvent('keydown', { key: k, keyCode, ctrlKey: true, shiftKey: shift, bubbles: true, cancelable: true });
  v.contentDOM.dispatchEvent(e);
  return e;
};
const input = (v: EditorView, inputType: string) => {
  const e = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
  v.contentDOM.dispatchEvent(e);
  return e;
};

describe('codeHistoryEdge', () => {
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
    expect(v.state.doc.toString()).toBe('hello');
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
    expect(v.state.doc.toString()).toBe('hello');
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
    // Between the edge (highest) and the history extension's own handler
    // (default), so it runs only if the edge passed the event on. It cannot go
    // after history: CodeMirror stops once an event is cancelled, and history
    // cancels every historyUndo it receives.
    const seen = vi.fn(() => false);
    const v = mount(edge, [Prec.high(EditorView.domEventHandlers({ beforeinput: seen }))]);
    input(v, 'historyUndo');
    expect(edge).toHaveBeenCalledWith('undo');
    expect(seen).toHaveBeenCalled();
    expect(v.state.doc.toString()).toBe('hello');
  });
});
