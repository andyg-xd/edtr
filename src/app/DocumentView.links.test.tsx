// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, createRef } from 'react';
import { DocumentView, type DocumentViewHandle } from './DocumentView';
import { DocumentSession } from '../files/documentSession';
import { formatForPath } from '../files/fileTypes';
import type { OpenDoc } from '../files/openDocuments';
import { MODES_OFF } from '../settings/writingModes';
import { EditorView as CMEditorView } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';

// Same stubs as DocumentView.find.test.tsx, for the same reasons: the image-drop
// listener reaches for a webview jsdom does not have, CodeMirror/ProseMirror
// measure ranges jsdom cannot, and ProseMirror's own mouse handling hit-tests.
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => new Promise<() => void>(() => {}) }),
}));
const openUrl = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));
// Every linked file in these fixtures is missing; the hint must say so.
vi.mock('../files/fileIo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../files/fileIo')>()),
  pathExists: async () => false,
}));
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function () { return [] as unknown as DOMRectList; };
  Range.prototype.getBoundingClientRect = function () { return new DOMRect(); };
}
if (typeof document.execCommand !== 'function') document.execCommand = () => false;
if (typeof document.elementFromPoint !== 'function') document.elementFromPoint = () => null;

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;
afterEach(async () => {
  if (root) { await act(async () => root!.unmount()); root = null; }
  container?.remove(); container = null;
  openUrl.mockReset();
});

const CASES = [
  { label: 'Markdown Live', path: '/tmp/links.md', text: 'See [the docs](https://example.com/docs), [the top](#top) or [gone](./gone.md).\n' },
  {
    label: 'HTML Live', path: '/tmp/links.html',
    text: '<!doctype html>\n<html><body><p>See <a href="https://example.com/docs">the docs</a>, <a href="#top">the top</a> or <a href="./gone.md">gone</a>.</p></body></html>',
  },
];

async function mount(path: string, text: string, viewMode: 'live' | 'code' = 'live') {
  container = document.createElement('div');
  document.body.appendChild(container);
  const session = new DocumentSession({ path, format: formatForPath(path), meta: { eol: 'lf', hadBom: false }, text });
  const doc: OpenDoc = { id: 'links-doc', session, viewMode };
  const onInfo = vi.fn();
  root = createRoot(container);
  await act(async () => root!.render(
    <DocumentView
      ref={createRef<DocumentViewHandle>()} doc={doc} effectiveTheme="light" modes={MODES_OFF}
      onSetWritingMode={() => {}} onExport={() => {}}
      onDirtyChange={() => {}} onLiveAvailableChange={() => {}} onError={() => {}} onInfo={onInfo}
    />,
  ));
  const c = container;
  const scope = c.querySelector('.html-live-view')?.shadowRoot ?? c;
  const link = (text: string) => Array.from(scope.querySelectorAll('a')).find((a) => a.textContent === text)!;
  return { c, onInfo, link };
}

const mouse = (el: Element, type: string, init: MouseEventInit = {}) =>
  act(async () => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })); });

describe.each(CASES)('DocumentView links — $label', ({ path, text }) => {
  it('⌘-click hands a web link to the browser', async () => {
    const { link } = await mount(path, text);
    await mouse(link('the docs'), 'mousedown', { metaKey: true });
    expect(openUrl).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('a plain click opens nothing', async () => {
    const { link } = await mount(path, text);
    await mouse(link('the docs'), 'mousedown');
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('invites a ⌘-click in the status bar for a link that will open', async () => {
    const { c, link } = await mount(path, text);
    await mouse(link('the docs'), 'mousemove');
    const hint = c.querySelector('.status-bar-link')!;
    expect(hint.textContent).toBe('https://example.com/docs · ⌘-click to open');
    expect(hint.classList.contains('is-openable')).toBe(true);
  });

  it('says why a section link will not open, and does not invite a click', async () => {
    const { c, link } = await mount(path, text);
    await mouse(link('the top'), 'mousemove');
    const hint = c.querySelector('.status-bar-link')!;
    expect(hint.textContent).toBe("#top · Edtr can't jump to sections yet");
    expect(hint.classList.contains('is-openable')).toBe(false);
  });

  it('says a linked file is missing before anyone clicks it', async () => {
    const { c, link } = await mount(path, text);
    await mouse(link('gone'), 'mousemove');
    await act(async () => { await Promise.resolve(); });
    expect(c.querySelector('.status-bar-link')?.textContent).toBe('./gone.md · File not found');
  });

  it('explains a section link in a notice instead of opening it', async () => {
    const { onInfo, link } = await mount(path, text);
    await mouse(link('the top'), 'mousedown', { metaKey: true });
    await act(async () => { await Promise.resolve(); });
    expect(openUrl).not.toHaveBeenCalled();
    expect(onInfo).toHaveBeenCalledWith(expect.stringMatching(/section/));
  });
});

describe.each(CASES)('DocumentView links — Code view, $label source', ({ path, text }) => {
  /** Code view has no link elements: point the editor's hit-test at the link's text instead. */
  async function mountCode(marker: string) {
    const { c, onInfo } = await mount(path, text, 'code');
    const cm = CMEditorView.findFromDOM(c.querySelector('.cm-editor') as HTMLElement)!;
    ensureSyntaxTree(cm.state, cm.state.doc.length, 5000);
    const at = text.indexOf(marker);
    cm.posAtCoords = (() => at) as CMEditorView['posAtCoords'];
    const fire = (type: string, init: MouseEventInit = {}) => mouse(cm.contentDOM, type, { clientX: 1, clientY: 1, ...init });
    return { c, onInfo, fire };
  }

  it('⌘-click on a link opens it', async () => {
    const { fire } = await mountCode('example.com/docs');
    await fire('mousedown', { metaKey: true });
    expect(openUrl).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('shows the same status-bar hint as Live view', async () => {
    const { c, fire } = await mountCode('example.com/docs');
    await fire('mousemove');
    const hint = c.querySelector('.status-bar-link')!;
    expect(hint.textContent).toBe('https://example.com/docs · ⌘-click to open');
    expect(hint.classList.contains('is-openable')).toBe(true);
  });

  it('explains a section link instead of opening it', async () => {
    const { onInfo, fire } = await mountCode('#top');
    await fire('mousedown', { metaKey: true });
    await act(async () => { await Promise.resolve(); });
    expect(openUrl).not.toHaveBeenCalled();
    expect(onInfo).toHaveBeenCalledWith(expect.stringMatching(/section/));
  });
});
