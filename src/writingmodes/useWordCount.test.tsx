// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useWordCount } from './useWordCount';

/**
 * Minimal stand-in for @testing-library/react's `renderHook`. This repo has
 * no testing-library dependency (not in package.json, not in node_modules)
 * and the project rule is "no new dependencies — not one", so this mounts
 * the hook through a real component via react-dom/client instead, the same
 * way `src/settings/useWritingModeSettings.test.tsx` does. Extended here with
 * a `rerender(props)` that feeds new props back into the same callback —
 * that file's version has nothing to rerender with; this suite's "does not
 * recount until the debounce elapses again" test needs exactly that.
 */
function renderHook<P, T>(callback: (props: P) => T, options?: { initialProps: P }) {
  let current: T;
  function Probe({ p }: { p: P }) {
    current = callback(p);
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<Probe p={options?.initialProps as P} />); });
  return {
    result: { get current() { return current; } },
    container,
    rerender(p: P) { act(() => { root.render(<Probe p={p} />); }); },
  };
}

const surface = {
  countableText: () => 'one two three',
  selectedText: () => '',
};

describe('useWordCount', () => {
  const containers: HTMLDivElement[] = [];

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    containers.splice(0).forEach((c) => c.remove());
  });

  it('reports nothing before the debounce elapses', () => {
    const h = renderHook(() => useWordCount(surface, 0));
    containers.push(h.container);
    expect(h.result.current).toBeNull();
  });

  it('reports the document counts after 150ms', async () => {
    const h = renderHook(() => useWordCount(surface, 0));
    containers.push(h.container);
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(h.result.current).toEqual({ words: 3, characters: 13 });
  });

  it('reports the SELECTION when one exists', async () => {
    const selected = { countableText: () => 'one two three', selectedText: () => 'one two' };
    const h = renderHook(() => useWordCount(selected, 0));
    containers.push(h.container);
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(h.result.current).toEqual({ words: 2, characters: 7 });
  });

  it('reports null for a null surface', async () => {
    const h = renderHook(() => useWordCount(null, 0));
    containers.push(h.container);
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(h.result.current).toBeNull();
  });

  it('does not recount until the debounce elapses again', async () => {
    const countable = vi.fn(() => 'a b');
    const s = { countableText: countable, selectedText: () => '' };
    const h = renderHook(({ v }: { v: number }) => useWordCount(s, v), { initialProps: { v: 0 } });
    containers.push(h.container);
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(countable).toHaveBeenCalledTimes(1);
    h.rerender({ v: 1 });
    h.rerender({ v: 2 });
    h.rerender({ v: 3 });
    // Three version bumps, still only the trailing edge fires.
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(countable).toHaveBeenCalledTimes(2);
  });
});
