import { describe, it, expect } from 'vitest';
import { exportTitle } from './exportTitle';

describe('exportTitle', () => {
  it('drops the extension', () => {
    expect(exportTitle('/docs/Release notes.md')).toBe('Release notes');
  });

  it('keeps a name that has no extension', () => {
    expect(exportTitle('/docs/README')).toBe('README');
  });

  it('drops only the LAST extension', () => {
    expect(exportTitle('/docs/notes.tar.gz')).toBe('notes.tar');
  });

  it('is not fooled by a dot in a folder name', () => {
    expect(exportTitle('/my.docs/note.md')).toBe('note');
  });

  it('keeps a dotfile whole instead of stripping it to nothing', () => {
    // The bug this locks: `.gitignore`.replace(/\.[^.]+$/, '') is '', which
    // would offer the save panel a bare ".html" with no name at all.
    expect(exportTitle('/docs/.gitignore')).toBe('.gitignore');
  });

  it('names an unsaved document', () => {
    expect(exportTitle(null)).toBe('Untitled');
  });
});
