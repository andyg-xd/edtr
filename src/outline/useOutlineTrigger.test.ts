// @vitest-environment jsdom
//
// When the outline is allowed to recompute.
//
// `buildOutline` is a FULL document parse — measured at 7.92 / 185.77 / 758.59
// ms at 200 / 5 000 / 20 000 lines. It rode a version key that every keystroke
// bumps, and it ran whether or not the outline panel was even open, so typing
// in a large file parsed the whole document synchronously on every character.
// The owner reported an ~10 second delay per keystroke on a large file in a
// debug build.
//
// Two separate problems, two separate guarantees below: don't compute when
// nobody can see the result, and don't compute mid-keystroke when they can.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';
import { useOutlineTrigger, OUTLINE_DEBOUNCE_MS } from './useOutlineTrigger';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * A minimal hook harness in the project's own idiom (react-dom/client + act).
 * No testing-library here, and this is not worth adding one for.
 */
async function renderHook<P>(hook: (p: P) => unknown, initial: P) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  let latest: unknown;
  const Probe = (props: { p: P }) => { latest = hook(props.p); return null; };
  await act(async () => root.render(createElement(Probe, { p: initial })));
  return {
    value: () => latest,
    rerender: async (p: P) => { await act(async () => root.render(createElement(Probe, { p }))); },
    unmount: async () => { await act(async () => root.unmount()); host.remove(); },
  };
}

describe('useOutlineTrigger', () => {
  it('returns a constant while the panel is hidden, so the memo never recomputes', async () => {
    const h = await renderHook((p: { visible: boolean; version: string }) =>
      useOutlineTrigger(p.visible, p.version), { visible: false, version: 'v1' });

    const first = h.value();
    await h.rerender({ visible: false, version: 'v2' });
    await h.rerender({ visible: false, version: 'v3' });

    // Identity, not equality: this value is a useMemo dependency.
    expect(h.value()).toBe(first);
    await h.unmount();
  });

  it('settles immediately when the panel opens, with no debounce wait', async () => {
    const h = await renderHook((p: { visible: boolean; version: string }) =>
      useOutlineTrigger(p.visible, p.version), { visible: false, version: 'v1' });

    await h.rerender({ visible: true, version: 'v1' });
    // No timers advanced. An outline that appears a fifth of a second after
    // you open the panel reads as slow.
    expect(h.value()).toBe('v1');
    await h.unmount();
  });

  it('does NOT settle mid-burst while the version keeps changing', async () => {
    const h = await renderHook((p: { visible: boolean; version: string }) =>
      useOutlineTrigger(p.visible, p.version), { visible: true, version: 'v1' });
    expect(h.value()).toBe('v1');

    // Three "keystrokes" closer together than the debounce.
    for (const v of ['v2', 'v3', 'v4']) {
      await h.rerender({ visible: true, version: v });
      await act(async () => { vi.advanceTimersByTime(OUTLINE_DEBOUNCE_MS - 10); });
    }
    // Still the value from before the burst — no parse happened during typing.
    expect(h.value()).toBe('v1');
    await h.unmount();
  });

  it('settles once the version stops changing', async () => {
    const h = await renderHook((p: { visible: boolean; version: string }) =>
      useOutlineTrigger(p.visible, p.version), { visible: true, version: 'v1' });

    await h.rerender({ visible: true, version: 'v2' });
    await act(async () => { vi.advanceTimersByTime(OUTLINE_DEBOUNCE_MS + 5); });

    expect(h.value()).toBe('v2');
    await h.unmount();
  });

  it('stops settling again once the panel closes', async () => {
    const h = await renderHook((p: { visible: boolean; version: string }) =>
      useOutlineTrigger(p.visible, p.version), { visible: true, version: 'v1' });

    await h.rerender({ visible: false, version: 'v2' });
    await act(async () => { vi.advanceTimersByTime(OUTLINE_DEBOUNCE_MS * 3); });

    // Hidden: back to the constant, regardless of how the version moved.
    expect(h.value()).not.toBe('v2');
    await h.unmount();
  });
});
