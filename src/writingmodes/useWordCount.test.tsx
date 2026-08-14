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

  it('reports nothing at 149ms, then the counts the instant 150ms elapses', async () => {
    // Review finding: asserting null before ANY timer advance is true even if
    // the debounce logic is entirely broken (e.g. it never fires at all). This
    // makes the 150ms boundary itself the thing under test — a value at 149ms
    // fails this, and no value at 150ms fails this too.
    const h = renderHook(() => useWordCount(surface, 0));
    containers.push(h.container);
    await act(async () => { vi.advanceTimersByTime(149); });
    expect(h.result.current).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(h.result.current).toEqual({ words: 3, characters: 13, isSelection: false });
  });

  it('reports the SELECTION when one exists', async () => {
    const selected = { countableText: () => 'one two three', selectedText: () => 'one two' };
    const h = renderHook(() => useWordCount(selected, 0));
    containers.push(h.container);
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(h.result.current).toEqual({ words: 2, characters: 7, isSelection: true });
  });

  it('reports null for a null surface', async () => {
    const h = renderHook(() => useWordCount(null, 0));
    containers.push(h.container);
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(h.result.current).toBeNull();
  });

  it('follows ONE surface through selected -> cleared -> whole document', async () => {
    // Review finding: every surface above is STATIC -- permanently empty or
    // permanently selected. `selectedText()` is re-read fresh on every debounce
    // fire (see useWordCount.ts), but no test drove that same surface through a
    // change, so a regression that memoized the first read (e.g. by the
    // surface's own identity, which never changes here) instead of re-invoking
    // it would have passed every test above. `version` still has to change each
    // time -- that is what tells useWordCount to re-arm the debounce at all --
    // but `selectedText()`'s RETURN VALUE is what must be seen to move.
    let selected = 'one';
    const s = { countableText: () => 'one two three', selectedText: () => selected };
    const h = renderHook(({ v }: { v: number }) => useWordCount(s, v), { initialProps: { v: 0 } });
    containers.push(h.container);
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(h.result.current).toEqual({ words: 1, characters: 3, isSelection: true }); // "one"

    selected = 'one two';
    h.rerender({ v: 1 });
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(h.result.current).toEqual({ words: 2, characters: 7, isSelection: true }); // "one two"

    selected = ''; // cleared back to a bare caret
    h.rerender({ v: 2 });
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(h.result.current).toEqual({ words: 3, characters: 13, isSelection: false }); // "one two three"
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

  it('reports isSelection alongside the numbers, so the bar can label them (6c-ii-b, F6)', async () => {
    // The scope travels WITH the counts rather than being re-derived at the
    // point of display: the hook is the only place that knows which of the two
    // texts it actually counted, and asking the status bar to work it out
    // again would be a second source of truth that could disagree.
    let selected = '';
    const s2 = { countableText: () => 'one two three', selectedText: () => selected };
    const h = renderHook(({ v }: { v: number }) => useWordCount(s2, v), { initialProps: { v: 0 } });
    containers.push(h.container);
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(h.result.current?.isSelection, 'a bare caret is not a selection').toBe(false);

    selected = 'one two';
    h.rerender({ v: 1 });
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(h.result.current?.isSelection).toBe(true);

    selected = '';
    h.rerender({ v: 2 });
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(h.result.current?.isSelection, 'clearing the selection must clear the label').toBe(false);
  });
});
