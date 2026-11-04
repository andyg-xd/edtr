// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { buildLiveDoc } from '../views/liveModel';
import { LiveView } from '../views/LiveView';
import { HtmlLiveView } from '../views/HtmlLiveView';
import { toLiveHtml } from '../views/htmlModel';
import { pmFocus } from '../writingmodes/pmFocus';

const SOURCE = [
  'Intro.',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  '```',
  '┌──┐',
  '└──┘',
  '```',
  '',
].join('\n');

let container: HTMLDivElement | null = null;
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

async function render(node: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
  return container;
}

async function mountMarkdown(onEdit = vi.fn()) {
  const r = buildLiveDoc(SOURCE);
  if (!r.ok) throw new Error('fixture degraded');
  let view: EditorView | null = null;
  const el = await render(createElement(LiveView, {
    doc: r.doc,
    onEdit,
    onViewReady: (v: EditorView | null) => { if (v) view = v; },
  }));
  const blocks = Array.from(el.querySelectorAll<HTMLElement>('.edtr-code'));
  return { el, view: view!, blocks, onEdit };
}

const toggleOf = (block: HTMLElement) => block.querySelector<HTMLButtonElement>(':scope > .code-wrap-toggle')!;

describe('code block label in Markdown Live', () => {
  it('draws each block as wrapper > label + pre > code, with the label outside the pre', async () => {
    const { blocks } = await mountMarkdown();
    expect(blocks).toHaveLength(2);
    const [js] = blocks;
    const button = toggleOf(js);
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('contenteditable')).toBe('false');
    expect(button.hasAttribute('aria-label')).toBe(false);
    expect(button.hasAttribute('aria-pressed')).toBe(false);
    const pre = js.querySelector(':scope > pre')!;
    expect(pre.getAttribute('data-lang')).toBe('js');
    expect(pre.querySelector(':scope > code')?.textContent).toBe('const x = 1;');
    expect(pre.contains(button)).toBe(false);
  });

  it('reads Wrap on an ordinary block and No wrap on a diagram', async () => {
    const { blocks: [js, diagram] } = await mountMarkdown();
    expect(toggleOf(js).textContent).toBe('Wrap');
    expect(toggleOf(js).hasAttribute('aria-label')).toBe(false);
    expect(js.classList.contains('edtr-wrap')).toBe(true);
    expect(toggleOf(diagram).textContent).toBe('No wrap');
    expect(diagram.classList.contains('edtr-nowrap')).toBe(true);
  });

  it('flips the block’s class and label on click, keeps the caret where it was, and reports no edit', async () => {
    const { view, blocks: [js], onEdit } = await mountMarkdown();
    await act(async () => { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2))); });
    const before = view.state.selection;
    const button = toggleOf(js);

    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    await act(async () => { button.click(); });

    expect(js.classList.contains('edtr-nowrap')).toBe(true);
    expect(js.classList.contains('edtr-wrap')).toBe(false);
    expect(toggleOf(js).textContent).toBe('No wrap');
    expect(view.state.selection.eq(before)).toBe(true);

    await act(async () => { toggleOf(js).click(); });
    expect(js.classList.contains('edtr-wrap')).toBe(true);
    expect(toggleOf(js).textContent).toBe('Wrap');
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('keeps working alongside focus mode, whose class lands on the same wrapper', async () => {
    const { view, blocks: [js] } = await mountMarkdown();
    await act(async () => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
      pmFocus(view).setFocusEnabled(true);
    });
    expect(js.classList.contains('edtr-dim')).toBe(true);
    expect(js.classList.contains('edtr-code')).toBe(true);
    await act(async () => { toggleOf(js).click(); });
    expect(js.classList.contains('edtr-dim')).toBe(true);
    expect(js.classList.contains('edtr-nowrap')).toBe(true);
  });

  it('puts no label anywhere in HTML Live', async () => {
    const res = toLiveHtml('<html><body><p>hi</p><pre><code>const x = 1;</code></pre></body></html>');
    if (!res.ok) throw new Error('expected ok');
    const el = await render(createElement(HtmlLiveView, { doc: res.doc, styleText: res.styleText }));
    const shadow = el.querySelector('.html-live-view')!.shadowRoot!;
    expect(shadow.querySelector('pre')).not.toBeNull();
    expect(shadow.querySelector('.code-wrap-toggle')).toBeNull();
    expect(el.querySelector('.code-wrap-toggle')).toBeNull();
  });
});
