// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, createRef } from 'react';
import type { EditorView as PMView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { EditorView as CMEditorView } from '@codemirror/view';
import { undoDepth as cmUndoDepth } from '@codemirror/commands';
import { DocumentView, type DocumentViewHandle } from './DocumentView';
import { DocumentSession } from '../files/documentSession';
import { formatForPath } from '../files/fileTypes';
import type { ViewMode } from '../files/openDocuments';
import { MODES_OFF } from '../settings/writingModes';
import { blockWraps } from '../codewrap/codeWrapPlugin';

// The Live editor each surface drives is captured so a test can place the caret.
const spy = vi.hoisted(() => ({ pm: null as unknown }));
vi.mock('../find/pmSurface', async (orig) => {
  const actual = await orig<typeof import('../find/pmSurface')>();
  return { ...actual, pmSurface: (view: PMView) => { spy.pm = view; return actual.pmSurface(view); } };
});
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => new Promise<() => void>(() => {}) }),
}));
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function (this: Range) { return [] as unknown as DOMRectList; };
  Range.prototype.getBoundingClientRect = function (this: Range) { return new DOMRect(); };
}
if (typeof document.execCommand !== 'function') document.execCommand = () => false;

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;
afterEach(async () => {
  if (root) { await act(async () => root!.unmount()); root = null; }
  container?.remove();
  container = null;
  spy.pm = null;
});

const MD = 'Intro paragraph.\n\n```js\nconst x = 1;\n```\n';
const HTML = '<!doctype html>\n<html><body><p>Intro</p><pre><code>const x = 1;</code></pre></body></html>\n';

function element(codeWrap: boolean, ref: React.Ref<DocumentViewHandle>, session: DocumentSession, viewMode: ViewMode) {
  return (
    <DocumentView
      ref={ref} doc={{ id: 'd', session, viewMode }} effectiveTheme="light" modes={MODES_OFF} codeWrap={codeWrap}
      onSetWritingMode={() => {}} onExport={() => {}}
      onDirtyChange={() => {}} onLiveAvailableChange={() => {}} onError={() => {}} onInfo={() => {}}
    />
  );
}

async function mount(path: string, text: string, viewMode: ViewMode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const ref = createRef<DocumentViewHandle>();
  const session = new DocumentSession({ path, format: formatForPath(path), meta: { eol: 'lf', hadBom: false }, text });
  await act(async () => root!.render(element(true, ref, session, viewMode)));
  return { ref, session, rerender: (codeWrap: boolean) => act(async () => root!.render(element(codeWrap, ref, session, viewMode))) };
}

const pm = () => spy.pm as PMView;

function codeBlockPos(view: PMView): number {
  let found = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock' && found < 0) found = pos;
    return found < 0;
  });
  return found;
}

describe('wrapCommand', () => {
  it('Markdown Live, caret in a code block: reports live and flips that block', async () => {
    const { ref, session } = await mount('/tmp/t.md', MD, 'live');
    const before = session.text;
    const pos = codeBlockPos(pm());
    await act(async () => { pm().dispatch(pm().state.tr.setSelection(TextSelection.create(pm().state.doc, pos + 2))); });
    expect(blockWraps(pm().state, pos)).toBe(true);
    let result: string | undefined;
    await act(async () => { result = ref.current!.wrapCommand(); });
    expect(result).toBe('live');
    expect(blockWraps(pm().state, pos)).toBe(false);
    expect(session.text).toBe(before);
  });

  it('Markdown Live, caret in a paragraph: reports live and changes nothing', async () => {
    const { ref } = await mount('/tmp/t.md', MD, 'live');
    const pos = codeBlockPos(pm());
    await act(async () => { pm().dispatch(pm().state.tr.setSelection(TextSelection.create(pm().state.doc, 2))); });
    let result: string | undefined;
    await act(async () => { result = ref.current!.wrapCommand(); });
    expect(result).toBe('live');
    expect(blockWraps(pm().state, pos)).toBe(true);
  });

  it('HTML Live: reports live and changes nothing', async () => {
    const { ref } = await mount('/tmp/t.html', HTML, 'live');
    expect(pm()).not.toBeNull();
    const docBefore = pm().state.doc;
    let result: string | undefined;
    await act(async () => { result = ref.current!.wrapCommand(); });
    expect(result).toBe('live');
    expect(pm().state.doc).toBe(docBefore);
  });

  it('Code view: reports code', async () => {
    const { ref } = await mount('/tmp/t.md', MD, 'code');
    expect(ref.current!.wrapCommand()).toBe('code');
  });
});

describe('codeWrap reaches the Code view', () => {
  it('follows the prop without remounting the editor or touching its history', async () => {
    const { session, rerender } = await mount('/tmp/t.md', MD, 'code');
    await rerender(false);
    const content = () => container!.querySelector('.cm-content')!;
    expect(content().classList.contains('cm-lineWrapping')).toBe(false);
    const editor = CMEditorView.findFromDOM(container!.querySelector('.cm-editor') as HTMLElement)!;
    const text = editor.state.doc.toString();
    const depth = cmUndoDepth(editor.state);

    await rerender(true);
    expect(content().classList.contains('cm-lineWrapping')).toBe(true);
    expect(CMEditorView.findFromDOM(container!.querySelector('.cm-editor') as HTMLElement)).toBe(editor);
    expect(editor.state.doc.toString()).toBe(text);
    expect(cmUndoDepth(editor.state)).toBe(depth);
    expect(session.text).toBe(MD);
  });
});
