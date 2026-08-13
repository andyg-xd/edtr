import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { codeFocus, focusDimExtension } from './codeFocus';

function mount(doc: string): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [focusDimExtension] }),
  });
  document.body.appendChild(view.dom);
  return view;
}

const dimmed = (v: EditorView) => v.dom.querySelectorAll('.cm-edtr-dim').length;

describe('focus mode over Code view', () => {
  it('dims nothing until it is switched on', () => {
    const view = mount('one\ntwo\nthree');
    expect(dimmed(view)).toBe(0);
    view.destroy();
  });

  it('dims every line except the caret line', () => {
    const view = mount('one\ntwo\nthree');
    view.dispatch({ selection: { anchor: 5 } }); // line 2
    codeFocus(view).setFocusEnabled(true);
    expect(dimmed(view)).toBe(2);
    view.destroy();
  });

  it('moves the lit line when the caret moves', () => {
    const view = mount('one\ntwo\nthree');
    codeFocus(view).setFocusEnabled(true);
    view.dispatch({ selection: { anchor: 0 } });
    expect(view.dom.querySelectorAll('.cm-line:not(.cm-edtr-dim)').length).toBe(1);
    view.dispatch({ selection: { anchor: 9 } });
    expect(view.dom.querySelectorAll('.cm-line:not(.cm-edtr-dim)').length).toBe(1);
    expect(dimmed(view)).toBe(2);
    view.destroy();
  });

  it('stops dimming when switched off', () => {
    const view = mount('one\ntwo');
    const s = codeFocus(view);
    s.setFocusEnabled(true);
    expect(dimmed(view)).toBeGreaterThan(0);
    s.setFocusEnabled(false);
    expect(dimmed(view)).toBe(0);
    view.destroy();
  });

  it('never changes the document', () => {
    const view = mount('one\ntwo');
    const before = view.state.doc.toString();
    const s = codeFocus(view);
    s.setFocusEnabled(true);
    view.dispatch({ selection: { anchor: 5 } });
    s.setFocusEnabled(false);
    expect(view.state.doc.toString()).toBe(before);
    view.destroy();
  });
});
