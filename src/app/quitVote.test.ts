import { describe, it, expect } from 'vitest';
import { quitVoteFor } from './quitVote';

describe('quitVoteFor', () => {
  it('Save votes ready only when the save succeeded', () => {
    expect(quitVoteFor('save', true)).toBe('ready');
    expect(quitVoteFor('save', false)).toBe('cancel');
  });
  it('Discard is a vote (never destroys) → always ready', () => {
    // saveOk is irrelevant for discard/cancel
    expect(quitVoteFor('discard', false)).toBe('ready');
    expect(quitVoteFor('discard', true)).toBe('ready');
  });
  it('Cancel aborts the quit', () => {
    expect(quitVoteFor('cancel', true)).toBe('cancel');
    expect(quitVoteFor('cancel', false)).toBe('cancel');
  });
});
