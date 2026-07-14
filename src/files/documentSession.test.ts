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

describe('DocumentSession.version', () => {
  it('starts at 0 and bumps on each setCurrentText', () => {
    const s = new DocumentSession(loaded);
    expect(s.version).toBe(0);
    s.setCurrentText('a');
    expect(s.version).toBe(1);
    s.setCurrentText('b');
    expect(s.version).toBe(2);
  });
});

const makeLoaded = (text: string, eol: 'lf' | 'crlf' = 'lf'): LoadedFile =>
  ({ path: '/d/a.md', text, meta: { eol, hadBom: false }, format: 'markdown' });

describe('DocumentSession.reload', () => {
  it('replaces text, becomes clean, adopts new meta, bumps version', () => {
    const s = new DocumentSession(makeLoaded('old', 'lf'));
    s.setCurrentText('my edit');
    expect(s.isDirty()).toBe(true);
    const v = s.version;
    s.reload(makeLoaded('fresh', 'crlf'));
    expect(s.text).toBe('fresh');
    expect(s.isDirty()).toBe(false);          // saved == current == 'fresh'
    expect(s.meta.eol).toBe('crlf');          // adopted the reloaded file's EOL
    expect(s.version).toBeGreaterThan(v);
  });
});
