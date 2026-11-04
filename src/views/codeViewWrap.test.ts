// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undoDepth } from '@codemirror/commands';
import { buildCodeViewExtensions, wrapCompartment, wrapExtensionFor } from './codeViewExtensions';

function mount(wrap?: boolean) {
  const state = EditorState.create({
    doc: 'alpha beta gamma',
    extensions: wrap === undefined ? buildCodeViewExtensions('markdown') : buildCodeViewExtensions('markdown', 'light', wrap),
  });
  return new EditorView({ state, parent: document.body });
}

describe('Code view line wrapping', () => {
  it('wraps when on', () => {
    const view = mount(true);
    expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(true);
    view.destroy();
  });

  it('wraps by default', () => {
    const view = mount();
    expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(true);
    view.destroy();
  });

  it('does not wrap when off', () => {
    const view = mount(false);
    expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(false);
    view.destroy();
  });

  it('reconfiguring keeps text, selection and undo depth', () => {
    const view = mount(true);
    view.dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' });
    view.dispatch({ selection: { anchor: 2, head: 5 } });
    const before = { doc: view.state.doc.toString(), sel: view.state.selection.main.toJSON(), depth: undoDepth(view.state) };
    view.dispatch({ effects: wrapCompartment.reconfigure(wrapExtensionFor(false)) });
    expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(false);
    expect(view.state.doc.toString()).toBe(before.doc);
    expect(view.state.selection.main.toJSON()).toEqual(before.sel);
    expect(undoDepth(view.state)).toBe(before.depth);
    view.destroy();
  });

  it('reconfiguring changes no bytes', () => {
    let docChanged = false;
    const state = EditorState.create({
      doc: 'alpha beta gamma',
      extensions: [
        buildCodeViewExtensions('markdown'),
        EditorView.updateListener.of((u) => { if (u.docChanged) docChanged = true; }),
      ],
    });
    const view = new EditorView({ state, parent: document.body });
    const before = view.state.doc.toString();
    view.dispatch({ effects: wrapCompartment.reconfigure(wrapExtensionFor(false)) });
    expect(view.state.doc.toString()).toBe(before);
    expect(docChanged).toBe(false);
    view.destroy();
  });
});
