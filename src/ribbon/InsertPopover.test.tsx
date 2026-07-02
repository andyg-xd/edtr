// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { InsertPopover } from './InsertPopover';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => '/picked/p.png') }));
vi.mock('../files/imageAssets', () => ({
  copyImageIntoAssets: vi.fn(async () => 'notes.assets/p.png'),
  resolveImageDisplaySrc: vi.fn(() => 'CONVERTED:/a/notes.assets/p.png'),
  IMAGE_EXTS: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'],
}));

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

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
    const el = await render(<InsertPopover kind="link" onConfirm={() => {}} onCancel={() => {}} />);
    expect(confirmBtn(el).disabled).toBe(true);
    await type(urlInput(el), 'http://x.test');
    expect(confirmBtn(el).disabled).toBe(false);
  });

  it('confirms with text + url', async () => {
    const onConfirm = vi.fn();
    const el = await render(<InsertPopover kind="link" initialText="Anthropic" onConfirm={onConfirm} onCancel={() => {}} />);
    expect(textInput(el).value).toBe('Anthropic');
    await type(urlInput(el), 'http://x.test');
    await act(async () => { confirmBtn(el).click(); });
    expect(onConfirm).toHaveBeenCalledWith({ text: 'Anthropic', url: 'http://x.test' });
  });

  it('Escape cancels', async () => {
    const onCancel = vi.fn();
    const el = await render(<InsertPopover kind="link" onConfirm={() => {}} onCancel={onCancel} />);
    await act(async () => {
      el.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalled();
  });

  it('a mousedown outside cancels', async () => {
    const onCancel = vi.fn();
    await render(<InsertPopover kind="image" onConfirm={() => {}} onCancel={onCancel} />);
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalled();
  });

  it('image kind labels the first field "Alt text"', async () => {
    const el = await render(<InsertPopover kind="image" onConfirm={() => {}} onCancel={() => {}} />);
    expect(el.textContent).toContain('Alt text');
  });

  it('focuses the URL input on mount', async () => {
    const el = await render(<InsertPopover kind="link" onConfirm={() => {}} onCancel={() => {}} />);
    expect(document.activeElement).toBe(urlInput(el));
  });

  it('URL input has autocapitalize=none and spellcheck=false', async () => {
    const el = await render(<InsertPopover kind="link" onConfirm={() => {}} onCancel={() => {}} />);
    const input = urlInput(el);
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.getAttribute('spellcheck')).toBe('false');
  });

  it('shows "Choose file…" only for image kind', async () => {
    const link = await render(<InsertPopover kind="link" onConfirm={() => {}} onCancel={() => {}} />);
    expect(chooseBtn(link)).toBeNull();
    const img = await render(<InsertPopover kind="image" docPath="/a/notes.md" onConfirm={() => {}} onCancel={() => {}} />);
    expect(chooseBtn(img)).not.toBeNull();
  });

  it('picking a file copies it and confirms with the relative path + displaySrc', async () => {
    const onConfirm = vi.fn();
    const el = await render(<InsertPopover kind="image" docPath="/a/notes.md" onConfirm={onConfirm} onCancel={() => {}} />);
    await act(async () => { chooseBtn(el)!.click(); });
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      url: 'notes.assets/p.png',
      displaySrc: 'CONVERTED:/a/notes.assets/p.png',
    }));
  });
});
