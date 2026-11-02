import { describe, it, expect } from 'vitest';
import { DocHistory, DOC_HISTORY_LIMIT } from './docHistory';

describe('DocHistory', () => {
  it('starts with nothing to undo or redo', () => {
    const h = new DocHistory();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo('x')).toBeNull();
    expect(h.redo('x')).toBeNull();
  });

  it('records a view session only when it changed the text', () => {
    const h = new DocHistory();
    h.endSession('same', 'same', 'Live', h.epoch);
    expect(h.canUndo).toBe(false);
    h.endSession('before', 'after', 'Live', h.epoch);
    expect(h.canUndo).toBe(true);
  });

  it('undo returns the text from before the session, redo returns the text it left', () => {
    const h = new DocHistory();
    h.endSession('one', 'two', 'Live', h.epoch);
    expect(h.undo('two')?.text).toBe('one');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
    expect(h.redo('one')?.text).toBe('two');
    expect(h.canRedo).toBe(false);
    expect(h.canUndo).toBe(true);
  });

  it('steps back through several sessions in order, and forward again', () => {
    const h = new DocHistory();
    h.endSession('a', 'b', 'Live', h.epoch);
    h.endSession('b', 'c', 'Live', h.epoch);
    expect(h.undo('c')?.text).toBe('b');
    expect(h.undo('b')?.text).toBe('a');
    expect(h.redo('a')?.text).toBe('b');
    expect(h.redo('b')?.text).toBe('c');
  });

  it('returns the stored bytes exactly', () => {
    const h = new DocHistory();
    const odd = 'line one\r\n|  a |b  |\r\n\t  trailing   \r\n';
    h.endSession(odd, 'flattened', 'Live', h.epoch);
    expect(h.undo('flattened')?.text).toBe(odd);
  });

  it('a new edit clears redo', () => {
    const h = new DocHistory();
    h.endSession('a', 'b', 'Live', h.epoch);
    h.undo('b');
    expect(h.canRedo).toBe(true);
    h.noteEdit();
    expect(h.canRedo).toBe(false);
    expect(h.redo('a')).toBeNull();
  });

  it('keeps only the most recent steps', () => {
    const h = new DocHistory();
    for (let i = 0; i < DOC_HISTORY_LIMIT + 5; i++) h.endSession(`v${i}`, `v${i + 1}`, 'Live', h.epoch);
    let steps = 0;
    let text = `v${DOC_HISTORY_LIMIT + 5}`;
    for (let t = h.undo(text); t !== null; t = h.undo(text)) { text = t.text; steps++; }
    expect(steps).toBe(DOC_HISTORY_LIMIT);
    expect(text).toBe('v5');
  });

  it('clear forgets everything', () => {
    const h = new DocHistory();
    h.endSession('a', 'b', 'Live', h.epoch);
    h.endSession('b', 'c', 'Live', h.epoch);
    h.undo('c');
    expect(h.canUndo && h.canRedo).toBe(true);
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it('remembers which view each step came from, for undo and for redo', () => {
    const h = new DocHistory();
    h.endSession('a', 'b', 'Live', h.epoch);
    h.endSession('b', 'c', 'Code', h.epoch);
    expect(h.undo('c')?.label).toBe('Code');
    expect(h.undo('b')?.label).toBe('Live');
    expect(h.redo('a')?.label).toBe('Live');
    expect(h.redo('b')?.label).toBe('Code');
  });

  it('ignores a session that began before a clear', () => {
    const h = new DocHistory();
    const before = h.epoch;
    h.clear();
    h.endSession('pre-reload', 'reloaded', 'Code', before);
    expect(h.canUndo).toBe(false);
  });
});
