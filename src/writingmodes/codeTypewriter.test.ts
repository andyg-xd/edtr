import { describe, it, expect, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { codeTypewriter } from './codeTypewriter';
import { END_PAD_RATIO, HOLD_RATIO } from './constants';

function mount(text: string): EditorView {
  const view = new EditorView({ state: EditorState.create({ doc: text }) });
  document.body.appendChild(view.dom);
  return view;
}

describe('codeTypewriter', () => {
  it('asks to scroll the caret line to the hold ratio', () => {
    const view = mount('one\ntwo\nthree');
    view.dispatch({ selection: { anchor: 5 } });
    // jsdom has no layout, so coordsAtPos returns null and the surface must
    // decline rather than throw. Stub it to prove the call is wired and that
    // the line's CENTRE (not its top) is what gets passed.
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 100, bottom: 120, left: 0, right: 0 });
    const scrolled: { targetCentreY: number; ratio: number }[] = [];
    const surface = codeTypewriter(view, (opts) => scrolled.push(opts));
    surface.holdCaret(HOLD_RATIO);
    expect(scrolled).toEqual([{ scroller: view.scrollDOM, targetCentreY: 110, ratio: HOLD_RATIO }]);
    view.destroy();
  });

  it('declines silently when the caret position has no coordinates', () => {
    const view = mount('one');
    vi.spyOn(view, 'coordsAtPos').mockReturnValue(null);
    const scrolled: unknown[] = [];
    const surface = codeTypewriter(view, (o) => scrolled.push(o));
    expect(() => surface.holdCaret(HOLD_RATIO)).not.toThrow();
    expect(scrolled).toEqual([]);
    view.destroy();
  });

  it('adds end padding as a pixel value and removes it again', () => {
    const view = mount('one');
    Object.defineProperty(view.scrollDOM, 'clientHeight', { value: 500, configurable: true });
    const surface = codeTypewriter(view);
    surface.setEndPadding(HOLD_RATIO);
    expect(view.scrollDOM.classList.contains('cm-edtr-typewriter')).toBe(true);
    expect(view.scrollDOM.style.getPropertyValue('--edtr-end-pad'))
      .toBe(`${Math.round(500 * END_PAD_RATIO)}px`);
    surface.setEndPadding(null);
    expect(view.scrollDOM.classList.contains('cm-edtr-typewriter')).toBe(false);
    expect(view.scrollDOM.style.getPropertyValue('--edtr-end-pad')).toBe('');
    view.destroy();
  });

  it('never dispatches a transaction — typewriter mode cannot touch the document', () => {
    const view = mount('one\ntwo');
    const before = view.state.doc.toString();
    const dispatch = vi.spyOn(view, 'dispatch');
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 0, bottom: 10, left: 0, right: 0 });
    const surface = codeTypewriter(view, () => {});
    surface.holdCaret(HOLD_RATIO);
    surface.setEndPadding(HOLD_RATIO);
    expect(dispatch).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe(before);
    view.destroy();
  });

  it('recomputes end padding on every held caret, so a window resize self-corrects at the next keystroke', () => {
    const view = mount('one');
    Object.defineProperty(view.scrollDOM, 'clientHeight', { value: 500, configurable: true });
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 0, bottom: 10, left: 0, right: 0 });
    const surface = codeTypewriter(view, () => {});
    surface.setEndPadding(HOLD_RATIO);
    expect(view.scrollDOM.style.getPropertyValue('--edtr-end-pad'))
      .toBe(`${Math.round(500 * END_PAD_RATIO)}px`);

    // Simulate the window growing without any toggle of the mode.
    Object.defineProperty(view.scrollDOM, 'clientHeight', { value: 800, configurable: true });
    surface.holdCaret(HOLD_RATIO);
    expect(view.scrollDOM.style.getPropertyValue('--edtr-end-pad'))
      .toBe(`${Math.round(800 * END_PAD_RATIO)}px`);
    view.destroy();
  });

  it('leaves end padding untouched from holdCaret when the mode is off', () => {
    const view = mount('one');
    Object.defineProperty(view.scrollDOM, 'clientHeight', { value: 500, configurable: true });
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ top: 0, bottom: 10, left: 0, right: 0 });
    const surface = codeTypewriter(view, () => {});
    // setEndPadding was never called — the mode is off.
    surface.holdCaret(HOLD_RATIO);
    expect(view.scrollDOM.style.getPropertyValue('--edtr-end-pad')).toBe('');
    expect(view.scrollDOM.classList.contains('cm-edtr-typewriter')).toBe(false);
    view.destroy();
  });
});
