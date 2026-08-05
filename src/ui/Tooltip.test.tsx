// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { EditorState } from 'prosemirror-state';
import { Tooltip } from './Tooltip';
import { RibbonView } from '../ribbon/RibbonView';
import { markdownRibbon } from '../ribbon/markdownRibbon';
import { liveSchema } from '../views/liveSchema';
import { buildLiveDoc } from '../views/liveModel';

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

async function render(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return { container: container! };
}

// A real EditorView is unnecessary here -- only .state is read by RibbonView
// when deciding isActive/isEnabled for each control.
function fakeMarkdownView() {
  const r = buildLiveDoc('hello\n');
  if (!r.ok) throw new Error('degraded');
  const state = EditorState.create({ doc: r.doc, schema: liveSchema });
  return { state, dispatch: vi.fn(), focus: vi.fn() } as any;
}

describe('accessibility: the debt we took on by rejecting native title', () => {
  it('every ribbon control is described by its tooltip', async () => {
    const { container } = await render(<RibbonView view={fakeMarkdownView()} controls={markdownRibbon} />);
    const controls = container.querySelectorAll('.ribbon-btn, .ribbon-select');
    // Guard against a vacuous pass: the ribbon must have actually rendered controls.
    expect(controls.length).toBe(markdownRibbon.length);
    controls.forEach((el) => {
      const id = el.getAttribute('aria-describedby');
      expect(id, `${el.textContent} has no aria-describedby`).toBeTruthy();
    });
  });
});

describe('Tooltip', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function renderTooltip() {
    return render(
      <Tooltip label="Bold" shortcut="⌘B" id="tip-bold">
        <button type="button">B</button>
      </Tooltip>,
    );
  }

  it('carries aria-describedby on the trigger unconditionally (before any hover)', async () => {
    const { container } = await renderTooltip();
    expect(container.querySelector('button')!.getAttribute('aria-describedby')).toBe('tip-bold');
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
  });

  // Native 'mouseenter'/'mouseleave'/'focus'/'blur' don't bubble, and React
  // delegates listening at the root using the bubbling 'mouseover'/'mouseout'
  // /'focusin'/'focusout' events to synthesize them -- so tests must raise
  // the real DOM API (`.focus()`/`.blur()`) or the bubbling event React
  // actually listens for, not the non-bubbling ones by the same name.
  function hover(el: Element) { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null })); }
  function unhover(el: Element) { el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null })); }

  it('does not appear before 150ms', async () => {
    const { container } = await renderTooltip();
    const trigger = container.querySelector('button')!;
    await act(async () => { hover(trigger); });
    await act(async () => { vi.advanceTimersByTime(149); });
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('appears after 150ms, showing the label and the shortcut key cap', async () => {
    const { container } = await renderTooltip();
    const trigger = container.querySelector('button')!;
    await act(async () => { hover(trigger); });
    await act(async () => { vi.advanceTimersByTime(150); });
    const tip = container.querySelector('[role="tooltip"]');
    expect(tip).toBeTruthy();
    expect(tip!.textContent).toContain('Bold');
    expect(tip!.querySelector('.tooltip-shortcut')?.textContent).toBe('⌘B');
  });

  it('shows on keyboard focus, not only on hover', async () => {
    const { container } = await renderTooltip();
    const trigger = container.querySelector('button')!;
    await act(async () => { trigger.focus(); });
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
  });

  it('hides immediately on blur, without waiting out any delay', async () => {
    const { container } = await renderTooltip();
    const trigger = container.querySelector('button')!;
    await act(async () => { trigger.focus(); });
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
    await act(async () => { trigger.blur(); });
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('hides immediately on mouseleave', async () => {
    const { container } = await renderTooltip();
    const trigger = container.querySelector('button')!;
    await act(async () => { hover(trigger); });
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
    await act(async () => { unhover(trigger); });
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('hides on Escape', async () => {
    const { container } = await renderTooltip();
    const trigger = container.querySelector('button')!;
    await act(async () => { hover(trigger); });
    await act(async () => { vi.advanceTimersByTime(150); });
    expect(container.querySelector('[role="tooltip"]')).toBeTruthy();
    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('re-entering after a hide restarts the 150ms delay (no stale timer leaks through)', async () => {
    const { container } = await renderTooltip();
    const trigger = container.querySelector('button')!;
    await act(async () => { hover(trigger); });
    await act(async () => { vi.advanceTimersByTime(100); });
    await act(async () => { unhover(trigger); });
    // The original timer must be cancelled -- advancing well past 150ms total
    // must NOT show the tooltip since the pointer already left.
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
  });
});
