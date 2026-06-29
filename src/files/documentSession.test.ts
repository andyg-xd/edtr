import { describe, it, expect } from 'vitest';
import { DocumentSession } from './documentSession';
import type { LoadedFile } from './fileTypes';

const loaded: LoadedFile = {
  path: '/x/a.md',
  text: 'hello\n',
  meta: { eol: 'lf', hadBom: false },
  format: 'markdown',
};

describe('DocumentSession', () => {
  it('is clean immediately after load', () => {
    expect(new DocumentSession(loaded).isDirty()).toBe(false);
  });

  it('becomes dirty after a real edit', () => {
    const s = new DocumentSession(loaded);
    s.setCurrentText('hello world\n');
    expect(s.isDirty()).toBe(true);
    expect(s.text).toBe('hello world\n');
  });

  it('is clean again when edited back to the saved text', () => {
    const s = new DocumentSession(loaded);
    s.setCurrentText('changed');
    s.setCurrentText('hello\n');
    expect(s.isDirty()).toBe(false);
  });

  it('is clean after markSaved, with the new text retained', () => {
    const s = new DocumentSession(loaded);
    s.setCurrentText('new body\n');
    s.markSaved();
    expect(s.isDirty()).toBe(false);
    expect(s.text).toBe('new body\n');
  });

  it('exposes path, format, and meta from the loaded file', () => {
    const s = new DocumentSession(loaded);
    expect(s.path).toBe('/x/a.md');
    expect(s.format).toBe('markdown');
    expect(s.meta).toEqual({ eol: 'lf', hadBom: false });
  });
});
