import { describe, it, expect } from 'vitest';
import { DocumentSession } from './documentSession';
import {
  emptyDocs, open, close, setActive, setViewMode, activeDoc, anyDirty,
} from './openDocuments';

const sess = (path: string, text = 'x') =>
  new DocumentSession({ path, format: 'markdown', meta: { eol: 'lf', hadBom: false }, text });

describe('openDocuments store', () => {
  it('open appends a doc, activates it, defaults viewMode to code', () => {
    const s = open(emptyDocs, sess('/a.md'), 'd0');
    expect(s.docs.map((d) => d.id)).toEqual(['d0']);
    expect(s.activeId).toBe('d0');
    expect(activeDoc(s)!.viewMode).toBe('code');
  });

  it('open supports N docs, activating the newest (used by 5b)', () => {
    let s = open(emptyDocs, sess('/a.md'), 'd0');
    s = open(s, sess('/b.md'), 'd1');
    expect(s.docs.map((d) => d.id)).toEqual(['d0', 'd1']);
    expect(s.activeId).toBe('d1');
  });

  it('close removes a doc; closing the active reselects a neighbor', () => {
    let s = open(open(emptyDocs, sess('/a.md'), 'd0'), sess('/b.md'), 'd1');
    s = setActive(s, 'd0');
    s = close(s, 'd0');
    expect(s.docs.map((d) => d.id)).toEqual(['d1']);
    expect(s.activeId).toBe('d1'); // reselected the surviving neighbor
  });

  it('close the last doc sets activeId to null', () => {
    const s = close(open(emptyDocs, sess('/a.md'), 'd0'), 'd0');
    expect(s.docs).toEqual([]);
    expect(s.activeId).toBeNull();
  });

  it('setViewMode changes only the targeted doc', () => {
    let s = open(open(emptyDocs, sess('/a.md'), 'd0'), sess('/b.md'), 'd1');
    s = setViewMode(s, 'd0', 'live');
    expect(s.docs.find((d) => d.id === 'd0')!.viewMode).toBe('live');
    expect(s.docs.find((d) => d.id === 'd1')!.viewMode).toBe('code');
  });

  it('anyDirty is true iff some doc session is dirty', () => {
    let s = open(emptyDocs, sess('/a.md'), 'x');
    expect(anyDirty(s)).toBe(false);
    activeDoc(s)!.session.setCurrentText('y'); // now dirty
    expect(anyDirty(s)).toBe(true);
  });
});
