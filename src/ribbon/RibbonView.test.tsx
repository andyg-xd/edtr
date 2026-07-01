// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import type { RibbonControl } from './RibbonModel';
import { RibbonView } from './RibbonView';

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
  id, label: id[0].toUpperCase(), ariaLabel: id,
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
      id: 'link', label: '🔗', ariaLabel: 'Link', isActive: () => false, isEnabled: () => true,
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
      id: 'link', label: '🔗', ariaLabel: 'Link', isActive: () => true, isEnabled: () => true,
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
      id: 'link', label: '🔗', ariaLabel: 'Link', isActive: () => false, isEnabled: () => true,
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
      id: 'link', label: '🔗', ariaLabel: 'Link', isActive: () => false, isEnabled: () => true,
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
      id: 'link', label: '🔗', ariaLabel: 'Link', isActive: () => false, isEnabled: () => true,
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
      id: 'link', label: '🔗', ariaLabel: 'Link', isActive: () => false, isEnabled: () => true,
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

  it('renders a dropdown control as a <select> and runs the command on change', async () => {
    const runFor = vi.fn(() => () => true);
    const control: RibbonControl = {
      id: 'heading', label: 'Paragraph', ariaLabel: 'Text style',
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
});
