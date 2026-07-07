// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DocumentSession } from '../files/documentSession';
import { useOpenDocuments } from './useOpenDocuments';

const sess = (path: string) =>
  new DocumentSession({ path, format: 'markdown', meta: { eol: 'lf', hadBom: false }, text: 'x' });

describe('useOpenDocuments', () => {
  it('openReplace makes exactly one active doc (5a single-doc behavior)', () => {
    const { result } = renderHook(() => useOpenDocuments());
    act(() => result.current.openReplace(sess('/a.md')));
    expect(result.current.state.docs.length).toBe(1);
    expect(result.current.active!.session.path).toBe('/a.md');
    act(() => result.current.openReplace(sess('/b.md')));
    expect(result.current.state.docs.length).toBe(1); // replaced, not appended
    expect(result.current.active!.session.path).toBe('/b.md');
  });

  it('setViewMode updates the active doc', () => {
    const { result } = renderHook(() => useOpenDocuments());
    act(() => result.current.openReplace(sess('/a.md')));
    const id = result.current.active!.id;
    act(() => result.current.setViewMode(id, 'live'));
    expect(result.current.active!.viewMode).toBe('live');
  });
});
