// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { InsertPopover } from './InsertPopover';
import { copyImageIntoAssets } from '../files/imageAssets';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => '/picked/p.png') }));
vi.mock('../files/imageAssets', () => ({
  copyImageIntoAssets: vi.fn(async () => 'notes.assets/p.png'),
  resolveImageDisplaySrc: vi.fn(() => 'CONVERTED:/a/notes.assets/p.png'),
  IMAGE_EXTS: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'],
}));

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; vi.mocked(copyImageIntoAssets).mockClear(); });

// A fake trigger rect (jsdom's real getBoundingClientRect always returns
// zeroes -- see the positioning tests below for why this is still a
// meaningful thing to inject).
const rect = (left: number, width = 32) =>
  ({ left, right: left + width, top: 40, bottom: 68, width, height: 28 }) as DOMRect;
const DEFAULT_RECT = rect(100);

async function render(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return container;
}
// React controlled inputs need the native value setter + an input event.
async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const urlInput = (el: HTMLElement) => el.querySelectorAll('input')[1] as HTMLInputElement;
const textInput = (el: HTMLElement) => el.querySelectorAll('input')[0] as HTMLInputElement;
const confirmBtn = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('button')).find((b) => /add/i.test(b.textContent ?? ''))! as HTMLButtonElement;
const chooseBtn = (el: HTMLElement) =>
  (Array.from(el.querySelectorAll('button')).find((b) => /choose file/i.test(b.textContent ?? '')) ??
    null) as HTMLButtonElement | null;

describe('InsertPopover', () => {
  it('disables confirm until the URL is non-empty', async () => {
    const el = await render(<InsertPopover kind="link" triggerRect={DEFAULT_RECT} onConfirm={() => {}} onCancel={() => {}} />);
    expect(confirmBtn(el).disabled).toBe(true);
    await type(urlInput(el), 'http://x.test');
    expect(confirmBtn(el).disabled).toBe(false);
  });

  it('confirms with text + url', async () => {
    const onConfirm = vi.fn();
    const el = await render(<InsertPopover kind="link" initialText="Anthropic" triggerRect={DEFAULT_RECT} onConfirm={onConfirm} onCancel={() => {}} />);
    expect(textInput(el).value).toBe('Anthropic');
    await type(urlInput(el), 'http://x.test');
    await act(async () => { confirmBtn(el).click(); });
    expect(onConfirm).toHaveBeenCalledWith({ text: 'Anthropic', url: 'http://x.test' });
  });

  it('Escape cancels', async () => {
    const onCancel = vi.fn();
    const el = await render(<InsertPopover kind="link" triggerRect={DEFAULT_RECT} onConfirm={() => {}} onCancel={onCancel} />);
    await act(async () => {
      el.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalled();
  });

  it('a mousedown outside cancels', async () => {
    const onCancel = vi.fn();
    await render(<InsertPopover kind="image" triggerRect={DEFAULT_RECT} onConfirm={() => {}} onCancel={onCancel} />);
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalled();
  });

  it('image kind labels the first field "Alt text"', async () => {
    const el = await render(<InsertPopover kind="image" triggerRect={DEFAULT_RECT} onConfirm={() => {}} onCancel={() => {}} />);
    expect(el.textContent).toContain('Alt text');
  });

  it('focuses the URL input on mount', async () => {
    const el = await render(<InsertPopover kind="link" triggerRect={DEFAULT_RECT} onConfirm={() => {}} onCancel={() => {}} />);
    expect(document.activeElement).toBe(urlInput(el));
  });

  it('URL input has autocapitalize=none and spellcheck=false', async () => {
    const el = await render(<InsertPopover kind="link" triggerRect={DEFAULT_RECT} onConfirm={() => {}} onCancel={() => {}} />);
    const input = urlInput(el);
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.getAttribute('spellcheck')).toBe('false');
  });

  it('shows "Choose file…" only for image kind', async () => {
    const link = await render(<InsertPopover kind="link" triggerRect={DEFAULT_RECT} onConfirm={() => {}} onCancel={() => {}} />);
    expect(chooseBtn(link)).toBeNull();
    const img = await render(<InsertPopover kind="image" docPath="/a/notes.md" triggerRect={DEFAULT_RECT} onConfirm={() => {}} onCancel={() => {}} />);
    expect(chooseBtn(img)).not.toBeNull();
  });

  it('picking a file copies it and confirms with the relative path + displaySrc', async () => {
    const onConfirm = vi.fn();
    const el = await render(<InsertPopover kind="image" docPath="/a/notes.md" triggerRect={DEFAULT_RECT} onConfirm={onConfirm} onCancel={() => {}} />);
    await act(async () => { chooseBtn(el)!.click(); });
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      url: 'notes.assets/p.png',
      displaySrc: 'CONVERTED:/a/notes.assets/p.png',
    }));
  });

  it('surfaces a copy failure via onError and does not confirm', async () => {
    vi.mocked(copyImageIntoAssets).mockRejectedValueOnce(new Error('disk full'));
    const onConfirm = vi.fn();
    const onError = vi.fn();
    const el = await render(
      <InsertPopover kind="image" docPath="/a/notes.md" triggerRect={DEFAULT_RECT} onConfirm={onConfirm} onError={onError} onCancel={() => {}} />
    );
    await act(async () => { chooseBtn(el)!.click(); });
    expect(onError).toHaveBeenCalledWith(expect.any(String));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disables "Choose file…" when docPath is null', async () => {
    const el = await render(<InsertPopover kind="image" triggerRect={DEFAULT_RECT} onConfirm={() => {}} onCancel={() => {}} />);
    const btn = chooseBtn(el);
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(true);
  });
});

// jsdom's getBoundingClientRect() always returns 0x0/at-origin regardless of
// CSS, so the popover's own measured size is always {width: 0, height: 0}
// here -- that's a jsdom limitation, not something these tests can control.
// What they CAN meaningfully verify: the position that reaches the DOM is
// derived from the *injected* triggerRect via the real anchorTo (not a
// mocked stand-in, and not a hardcoded 8px), so a control at a different
// spot on the ribbon produces a different, correctly-clamped position.
describe('InsertPopover positioning (anchorTo)', () => {
  const VIEWPORT_WIDTH = 1000;
  const VIEWPORT_HEIGHT = 800;

  // `fn` is async (it renders, which awaits `act`), so restoration must wait
  // for it to actually finish -- restoring synchronously right after calling
  // `fn()` would reset the viewport before the layout effect inside it runs.
  async function withViewport<T>(fn: () => Promise<T>): Promise<T> {
    const prevW = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    const prevH = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    Object.defineProperty(window, 'innerWidth', { value: VIEWPORT_WIDTH, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: VIEWPORT_HEIGHT, configurable: true });
    try {
      return await fn();
    } finally {
      if (prevW) Object.defineProperty(window, 'innerWidth', prevW); else delete (window as any).innerWidth;
      if (prevH) Object.defineProperty(window, 'innerHeight', prevH); else delete (window as any).innerHeight;
    }
  }

  it('opens beneath its trigger, not at the ribbon edge', async () => {
    // A control positioned well to the right of the ribbon (e.g. the image
    // button), not the far-left control the old `left: 8px` always used.
    const el = await withViewport(() =>
      render(<InsertPopover kind="link" triggerRect={rect(500)} onConfirm={() => {}} onCancel={() => {}} />),
    );
    const popover = el.querySelector('.insert-popover') as HTMLElement;
    // Floating width is 0 in jsdom (see file-level comment), so anchorTo
    // centres it exactly on the trigger's centre: 500 + 32/2 = 516.
    expect(popover.style.left).toBe('516px');
    expect(popover.style.left).not.toBe('8px');
    // Below the trigger (bottom 68 + the default 6px gap), not flush to the
    // ribbon's own top.
    expect(popover.style.top).toBe('74px');
  });

  it('clamps inside the window when its trigger is at the right edge', async () => {
    // A trigger near the viewport's right edge: its centre (990+16=1006)
    // overflows past 1000px, so anchorTo must clamp -- the naive centred
    // position would place it off-screen.
    const el = await withViewport(() =>
      render(<InsertPopover kind="link" triggerRect={rect(990)} onConfirm={() => {}} onCancel={() => {}} />),
    );
    const popover = el.querySelector('.insert-popover') as HTMLElement;
    // Uncapped this would be 1006px (off the 1000px-wide viewport); clamped
    // to viewport 1000 - floating 0 - margin 4 = 996.
    expect(popover.style.left).toBe('996px');
    expect(popover.style.left).not.toBe('8px');
  });

  it('a control further right produces a different position than one further left', async () => {
    // Directly guards against the pre-existing bug: two different triggers
    // must not collapse onto the same fixed left offset.
    const leftEl = await withViewport(() =>
      render(<InsertPopover kind="link" triggerRect={rect(100)} onConfirm={() => {}} onCancel={() => {}} />),
    );
    const leftPos = (leftEl.querySelector('.insert-popover') as HTMLElement).style.left;
    leftEl.remove(); // this test renders twice; don't leak the first mount into the DOM
    const rightEl = await withViewport(() =>
      render(<InsertPopover kind="link" triggerRect={rect(700)} onConfirm={() => {}} onCancel={() => {}} />),
    );
    const rightPos = (rightEl.querySelector('.insert-popover') as HTMLElement).style.left;
    expect(leftPos).not.toBe(rightPos);
  });
});
