// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { runMenuHistory } from './menuHistory';

afterEach(() => { document.body.innerHTML = ''; });

function focusIn(html: string, selector: string) {
  document.body.innerHTML = html;
  const el = document.querySelector<HTMLElement>(selector)!;
  el.focus();
  return el;
}

describe('runMenuHistory', () => {
  it('in a text field outside the editors, undoes the field the way the system does', () => {
    focusIn('<div class="find-bar"><input class="find-input"></div>', 'input');
    const exec = vi.fn(() => true);
    const doc = { historyStep: vi.fn() };
    runMenuHistory('undo', doc, exec);
    expect(exec).toHaveBeenCalledWith('undo');
    expect(doc.historyStep).not.toHaveBeenCalled();
  });

  it('redo in a text field is the system redo', () => {
    focusIn('<textarea></textarea>', 'textarea');
    const exec = vi.fn(() => true);
    runMenuHistory('redo', { historyStep: vi.fn() }, exec);
    expect(exec).toHaveBeenCalledWith('redo');
  });

  it('with focus on the page, steps the document', () => {
    document.body.innerHTML = '<button>Replace all</button>';
    document.querySelector('button')!.focus();
    const exec = vi.fn(() => true);
    const doc = { historyStep: vi.fn() };
    runMenuHistory('undo', doc, exec);
    expect(doc.historyStep).toHaveBeenCalledWith('undo');
    expect(exec).not.toHaveBeenCalled();
  });

  it('with focus in an editor, steps the document, not the system', () => {
    focusIn('<div class="cm-editor"><div class="cm-content" contenteditable="true" tabindex="0"></div></div>', '.cm-content');
    const exec = vi.fn(() => true);
    const doc = { historyStep: vi.fn() };
    runMenuHistory('redo', doc, exec);
    expect(doc.historyStep).toHaveBeenCalledWith('redo');
    expect(exec).not.toHaveBeenCalled();
  });

  it('with no document open, falls back to the system', () => {
    const exec = vi.fn(() => true);
    runMenuHistory('undo', null, exec);
    expect(exec).toHaveBeenCalledWith('undo');
  });
});
