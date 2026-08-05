// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { EditorState } from 'prosemirror-state';
import type { RibbonControl, RibbonGroup } from './RibbonModel';
import { RibbonView } from './RibbonView';
import { liveSchema } from '../views/liveSchema';
import { buildLiveDoc } from '../views/liveModel';
import { markdownRibbon } from './markdownRibbon';
import { htmlRibbon } from './htmlRibbon';
import { markdownTableRibbon } from './markdownTableRibbon';
import { htmlTableRibbon } from './htmlTableRibbon';

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

async function render(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return { container: container!, root };
}

// A minimal fake EditorView: only the bits RibbonView touches.
function fakeView() {
  return {
    state: { selection: { from: 0, to: 0 }, doc: { textBetween: () => 'sel' } },
    dispatch: vi.fn(),
    focus: vi.fn(),
  } as any;
}

const cmdControl = (id: string, opts: Partial<RibbonControl> = {}): RibbonControl => ({
  id, label: id[0].toUpperCase(), ariaLabel: id, group: 'inline',
  isActive: () => false, isEnabled: () => true,
  action: { kind: 'command', run: () => true },
  ...opts,
});

const btn = (el: HTMLElement, aria: string) =>
  Array.from(el.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === aria)! as HTMLButtonElement;

describe('RibbonView', () => {
  it('renders a toolbar with one button per control', async () => {
    const { container } = await render(<RibbonView view={fakeView()} controls={[cmdControl('bold'), cmdControl('italic')]} />);
    expect(container.querySelector('[role="toolbar"]')).toBeTruthy();
    expect(container.querySelectorAll('button.ribbon-btn').length).toBe(2);
  });

  it('reflects active + enabled state', async () => {
    const controls = [
      cmdControl('bold', { isActive: () => true }),
      cmdControl('italic', { isEnabled: () => false }),
    ];
    const { container } = await render(<RibbonView view={fakeView()} controls={controls} />);
    expect(btn(container, 'bold').getAttribute('aria-pressed')).toBe('true');
    expect(btn(container, 'bold').classList.contains('is-active')).toBe(true);
    expect(btn(container, 'italic').disabled).toBe(true);
  });

  it('runs a command control on click and refocuses the editor', async () => {
    const run = vi.fn(() => true);
    const view = fakeView();
    const { container } = await render(<RibbonView view={view} controls={[cmdControl('bold', { action: { kind: 'command', run } })]} />);
    await act(async () => { btn(container, 'bold').click(); });
    expect(run).toHaveBeenCalledWith(view.state, view.dispatch);
    expect(view.focus).toHaveBeenCalled();
  });

  it('opens the popover for an inactive popover control, then runs buildCommand on confirm', async () => {
    const built = vi.fn(() => true);
    const link: RibbonControl = {
      id: 'link', label: '🔗', ariaLabel: 'Link', group: 'insert', isActive: () => false, isEnabled: () => true,
      action: { kind: 'popover', popover: 'link', buildCommand: () => built },
    };
    const view = fakeView();
    const { container } = await render(<RibbonView view={view} controls={[link]} />);
    await act(async () => { btn(container, 'Link').click(); });
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    // fill URL + confirm
    const urlEl = container.querySelectorAll('input')[1] as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(urlEl, 'http://x.test'); urlEl.dispatchEvent(new Event('input', { bubbles: true })); });
    const addBtn = Array.from(container.querySelectorAll('button')).find((b) => /add/i.test(b.textContent ?? ''))!;
    await act(async () => { addBtn.click(); });
    expect(built).toHaveBeenCalledWith(view.state, view.dispatch);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(view.focus).toHaveBeenCalled();
  });

  it('runs whenActiveRun (not the popover) when a popover control is active', async () => {
    const remove = vi.fn(() => true);
    const link: RibbonControl = {
      id: 'link', label: '🔗', ariaLabel: 'Link', group: 'insert', isActive: () => true, isEnabled: () => true,
      action: { kind: 'popover', popover: 'link', buildCommand: () => () => true, whenActiveRun: remove },
    };
    const view = fakeView();
    const { container } = await render(<RibbonView view={view} controls={[link]} />);
    await act(async () => { btn(container, 'Link').click(); });
    expect(remove).toHaveBeenCalledWith(view.state, view.dispatch);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(view.focus).toHaveBeenCalled();
  });

  it('a linkRequest bump opens the link popover', async () => {
    const link: RibbonControl = {
      id: 'link', label: '🔗', ariaLabel: 'Link', group: 'insert', isActive: () => false, isEnabled: () => true,
      action: { kind: 'popover', popover: 'link', buildCommand: () => () => true },
    };
    const view = fakeView();
    const { container, root } = await render(<RibbonView view={view} controls={[link]} linkRequest={0} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { root.render(<RibbonView view={view} controls={[link]} linkRequest={1} />); });
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('linkRequest nonzero on mount does NOT open the popover; only an increase does', async () => {
    const link: RibbonControl = {
      id: 'link', label: '🔗', ariaLabel: 'Link', group: 'insert', isActive: () => false, isEnabled: () => true,
      action: { kind: 'popover', popover: 'link', buildCommand: () => () => true },
    };
    const view = fakeView();
    // Mount with nonzero linkRequest (simulating remount after a prior ⌘K)
    const { container, root } = await render(<RibbonView view={view} controls={[link]} linkRequest={2} />);
    // Must NOT open the popover on mount
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    // Increase the value — NOW the popover should open
    await act(async () => { root.render(<RibbonView view={view} controls={[link]} linkRequest={3} />); });
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('keeps popover open and does not refocus when buildCommand returns false', async () => {
    const builtFalse = vi.fn(() => false);
    const link: RibbonControl = {
      id: 'link', label: '🔗', ariaLabel: 'Link', group: 'insert', isActive: () => false, isEnabled: () => true,
      action: { kind: 'popover', popover: 'link', buildCommand: () => builtFalse },
    };
    const view = fakeView();
    const { container } = await render(<RibbonView view={view} controls={[link]} />);
    // Open the popover by clicking the link button
    await act(async () => { btn(container, 'Link').click(); });
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    // Fill URL
    const urlEl = container.querySelectorAll('input')[1] as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(urlEl, 'http://x.test'); urlEl.dispatchEvent(new Event('input', { bubbles: true })); });
    // Confirm
    const addBtn = Array.from(container.querySelectorAll('button')).find((b) => /add/i.test(b.textContent ?? ''))!;
    await act(async () => { addBtn.click(); });
    // Command returned false → dialog must remain open, focus must NOT have been called
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(view.focus).not.toHaveBeenCalled();
  });

  it('closes popover and refocuses when buildCommand returns true', async () => {
    const builtTrue = vi.fn(() => true);
    const link: RibbonControl = {
      id: 'link', label: '🔗', ariaLabel: 'Link', group: 'insert', isActive: () => false, isEnabled: () => true,
      action: { kind: 'popover', popover: 'link', buildCommand: () => builtTrue },
    };
    const view = fakeView();
    const { container } = await render(<RibbonView view={view} controls={[link]} />);
    await act(async () => { btn(container, 'Link').click(); });
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    const urlEl = container.querySelectorAll('input')[1] as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(urlEl, 'http://x.test'); urlEl.dispatchEvent(new Event('input', { bubbles: true })); });
    const addBtn = Array.from(container.querySelectorAll('button')).find((b) => /add/i.test(b.textContent ?? ''))!;
    await act(async () => { addBtn.click(); });
    // Command returned true → dialog must close, focus must have been called
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(view.focus).toHaveBeenCalled();
  });

  it('opens the size picker for a sizePicker control and runs buildCommand on select', async () => {
    const built = vi.fn(() => true);
    const buildCommand = vi.fn(() => built);
    const control: RibbonControl = {
      id: 'insertTable', label: '⊞', ariaLabel: 'Insert table', group: 'structure',
      isActive: () => false, isEnabled: () => true,
      action: { kind: 'sizePicker', buildCommand },
    };
    const view = fakeView();
    const { container } = await render(<RibbonView view={view} controls={[control]} />);
    await act(async () => { btn(container, 'Insert table').click(); });
    expect(container.querySelector('.table-size-picker')).toBeTruthy();
    const cells = Array.from(container.querySelectorAll('.tsp-cell'));
    await act(async () => { cells[9].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }); // row2,col2
    expect(buildCommand).toHaveBeenCalledWith(2, 2);
    expect(built).toHaveBeenCalledWith(view.state, view.dispatch);
    expect(container.querySelector('.table-size-picker')).toBeNull();
    expect(view.focus).toHaveBeenCalled();
  });

  it('renders a dropdown control as a <select> and runs the command on change', async () => {
    const runFor = vi.fn(() => () => true);
    const control: RibbonControl = {
      id: 'heading', label: 'Paragraph', ariaLabel: 'Text style', group: 'block',
      isActive: () => false, isEnabled: () => true,
      action: { kind: 'dropdown',
        options: [{ label: 'Paragraph', value: 'paragraph' }, { label: 'Heading 2', value: 'h2' }],
        getValue: () => 'paragraph', run: runFor },
    };
    const view = fakeView();
    const { container } = await render(<RibbonView view={view} controls={[control]} />);
    const select = container.querySelector('select.ribbon-select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe('paragraph');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(select, 'h2'); select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(runFor).toHaveBeenCalledWith('h2');
    expect(view.focus).toHaveBeenCalled();
  });

  it('renders a divider exactly at each group boundary, never leading or trailing the row', async () => {
    const controls = [
      cmdControl('a', { group: 'inline' }),
      cmdControl('b', { group: 'inline' }),
      cmdControl('c', { group: 'insert' }),
      cmdControl('d', { group: 'block' }),
      cmdControl('e', { group: 'block' }),
    ];
    const { container } = await render(<RibbonView view={fakeView()} controls={controls} />);
    const row = container.querySelector('.ribbon')!;
    const kinds = Array.from(row.children).map((el) =>
      el.classList.contains('ribbon-divider') ? 'divider' : 'control');
    // a, b, divider(inline→insert), c, divider(insert→block), d, e
    expect(kinds).toEqual(['control', 'control', 'divider', 'control', 'divider', 'control', 'control']);
    expect(container.querySelectorAll('.ribbon-divider').length).toBe(2);
    expect(kinds[0]).toBe('control'); // never leads
    expect(kinds[kinds.length - 1]).toBe('control'); // never trails
  });

  it('a run of same-group controls gets no divider between them', async () => {
    const controls = [cmdControl('a', { group: 'inline' }), cmdControl('b', { group: 'inline' })];
    const { container } = await render(<RibbonView view={fakeView()} controls={controls} />);
    expect(container.querySelectorAll('.ribbon-divider').length).toBe(0);
  });

  it('dividers are aria-hidden so screen readers do not announce them', async () => {
    const controls = [cmdControl('a', { group: 'inline' }), cmdControl('b', { group: 'insert' })];
    const { container } = await render(<RibbonView view={fakeView()} controls={controls} />);
    const divider = container.querySelector('.ribbon-divider')!;
    expect(divider.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('ribbon grouping', () => {
  const allRibbons: [string, RibbonControl[]][] = [
    ['markdownRibbon', markdownRibbon],
    ['htmlRibbon', htmlRibbon],
    ['markdownTableRibbon', markdownTableRibbon],
    ['htmlTableRibbon', htmlTableRibbon],
  ];
  const validGroups: RibbonGroup[] = ['inline', 'insert', 'block', 'structure'];

  it('every control in all four ribbons has a valid group', () => {
    for (const [name, ribbon] of allRibbons) {
      for (const c of ribbon) {
        expect(validGroups, `${name}.${c.id} has group ${String(c.group)}`).toContain(c.group);
      }
    }
  });

  it('shortcut is set on exactly bold/italic/link (all ribbons) and underline (HTML only)', () => {
    const withShortcut = (ribbon: RibbonControl[]) =>
      ribbon.filter((c) => c.shortcut !== undefined).map((c) => c.id).sort();
    expect(withShortcut(markdownRibbon)).toEqual(['bold', 'italic', 'link']);
    expect(withShortcut(htmlRibbon)).toEqual(['bold', 'italic', 'link', 'underline']);
    expect(withShortcut(markdownTableRibbon)).toEqual([]);
    expect(withShortcut(htmlTableRibbon)).toEqual([]);
  });

});

// Task 6: the popover must open beneath the control that was actually
// clicked, not always flush to the ribbon's left edge. InsertPopover.test.tsx
// proves InsertPopover positions correctly given a triggerRect; these tests
// prove RibbonView captures the RIGHT rect for whichever control opened it
// (not the first control, not a stale one from a previous open).
describe('popover triggerRect wiring (Task 6)', () => {
  function fakeRect(left: number): DOMRect {
    return { left, right: left + 32, top: 0, bottom: 28, width: 32, height: 28 } as DOMRect;
  }
  function zeroRect(): DOMRect {
    return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 } as DOMRect;
  }

  // jsdom's real getBoundingClientRect() always returns zeroes regardless of
  // layout, so a per-element spy is the only way to give two different
  // controls two different (deterministic) rects in this environment.
  function withFakeRects(rectsByAriaLabel: Record<string, DOMRect>) {
    return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const label = this.getAttribute?.('aria-label');
      return (label ? rectsByAriaLabel[label] : undefined) ?? zeroRect();
    });
  }

  function withViewport<T>(width: number, height: number, fn: () => T): T {
    const prevW = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    const prevH = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
    try {
      return fn();
    } finally {
      if (prevW) Object.defineProperty(window, 'innerWidth', prevW); else delete (window as any).innerWidth;
      if (prevH) Object.defineProperty(window, 'innerHeight', prevH); else delete (window as any).innerHeight;
    }
  }

  const popoverControl = (id: string, ariaLabel: string): RibbonControl => ({
    id, label: id, ariaLabel, group: 'insert', isActive: () => false, isEnabled: () => true,
    action: { kind: 'popover', popover: 'link', buildCommand: () => () => true },
  });

  it("uses the clicked control's own rect, not the first control in the ribbon", async () => {
    const linkA = popoverControl('linkA', 'Link A');
    const linkB = popoverControl('linkB', 'Link B');
    const view = fakeView();
    const { container } = await render(<RibbonView view={view} controls={[linkA, linkB]} />);

    const spy = withFakeRects({ 'Link A': fakeRect(50), 'Link B': fakeRect(400) });
    try {
      await withViewport(1000, 800, async () => {
        await act(async () => { btn(container, 'Link B').click(); });
      });
      const popover = container.querySelector('.insert-popover') as HTMLElement;
      // Link B: left 400, width 32 -> centre 416. The popover's own measured
      // size is 0 in jsdom (its root div has no 'Link A'/'Link B' aria-label,
      // so the spy falls through to zeroRect()), so anchorTo centres it
      // exactly on 416 -- not on Link A's rect, and not the old fixed 8px.
      expect(popover.style.left).toBe('416px');
      expect(popover.style.left).not.toBe('8px');
    } finally {
      spy.mockRestore();
    }
  });

  it('a second, later click on a different control repositions the popover (no stale rect)', async () => {
    const linkA = popoverControl('linkA', 'Link A');
    const linkB = popoverControl('linkB', 'Link B');
    const view = fakeView();
    const { container } = await render(<RibbonView view={view} controls={[linkA, linkB]} />);

    const spy = withFakeRects({ 'Link A': fakeRect(50), 'Link B': fakeRect(400) });
    try {
      await withViewport(1000, 800, async () => {
        await act(async () => { btn(container, 'Link A').click(); });
      });
      const firstLeft = (container.querySelector('.insert-popover') as HTMLElement).style.left;
      await withViewport(1000, 800, async () => {
        await act(async () => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }); // dismiss
        await act(async () => { btn(container, 'Link B').click(); });
      });
      const secondLeft = (container.querySelector('.insert-popover') as HTMLElement).style.left;
      expect(secondLeft).not.toBe(firstLeft);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('markdownRibbon grouping', () => {
  it('markdownRibbon renders exactly 3 dividers across its 4 groups', async () => {
    const r = buildLiveDoc('hello\n');
    if (!r.ok) throw new Error('degraded');
    const state = EditorState.create({ doc: r.doc, schema: liveSchema });
    const view = { state, dispatch: vi.fn(), focus: vi.fn() } as any;
    const { container } = await render(<RibbonView view={view} controls={markdownRibbon} />);
    const row = container.querySelector('.ribbon')!;
    // one control element per ribbon control (button or select) + one divider per group boundary
    expect(row.querySelectorAll('.ribbon-btn, select.ribbon-select').length).toBe(markdownRibbon.length);
    expect(row.querySelectorAll('.ribbon-divider').length).toBe(3);
    expect(new Set(markdownRibbon.map((c) => c.group)).size).toBe(4);
    // never leads or trails
    const children = Array.from(row.children);
    expect(children[0].classList.contains('ribbon-divider')).toBe(false);
    expect(children[children.length - 1].classList.contains('ribbon-divider')).toBe(false);
  });
});
