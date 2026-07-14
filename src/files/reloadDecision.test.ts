import { describe, it, expect } from 'vitest';
import { decideReloadState } from './reloadDecision';

describe('decideReloadState', () => {
  it('null on-disk (re-read failed) → deleted', () => {
    expect(decideReloadState(null, 'x', false)).toBe('deleted');
    expect(decideReloadState(null, 'x', true)).toBe('deleted');
  });
  it('on-disk equals saved → null (no banner)', () => {
    expect(decideReloadState('x', 'x', false)).toBeNull();
    expect(decideReloadState('x', 'x', true)).toBeNull(); // self-write while dirty elsewhere
  });
  it('differs + clean → changed', () => {
    expect(decideReloadState('new', 'old', false)).toBe('changed');
  });
  it('differs + dirty → conflict', () => {
    expect(decideReloadState('new', 'old', true)).toBe('conflict');
  });
});
