// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, forwardRef, useEffect, useImperativeHandle } from 'react';
import type { MenuHandlers } from './menuCommands';
import { DocumentSession } from '../files/documentSession';

// The routing under test: ⌥⌘Z flips this window's Code view wrapping unless
// the showing document view claims it. The view and the wrap hook are stubbed
// so only EditorWindow's decision is measured.
const h = vi.hoisted(() => ({
  handlers: null as unknown as MenuHandlers,
  toggleCodeWrap: vi.fn(),
  syncWrapMenu: vi.fn(),
  reportLiveWrap: vi.fn(),
  docProps: null as null | Record<string, unknown>,
  claim: 'code' as 'live' | 'code',
  seed: null as unknown,
}));

vi.mock('./MenuBridge', () => ({ useMenuAndCloseGuard: (handlers: MenuHandlers) => { h.handlers = handlers; } }));
vi.mock('../settings/useCodeWrap', () => ({
  useCodeWrap: () => ({ codeWrap: true, toggleCodeWrap: h.toggleCodeWrap, syncWrapMenu: h.syncWrapMenu, reportLiveWrap: h.reportLiveWrap }),
}));
vi.mock('../settings/useWindowWritingModes', () => ({
  useWindowWritingModes: () => ({ modes: { typewriter: false, focus: false }, setMode: () => {}, toggleMode: () => {} }),
}));
vi.mock('./DocumentView', () => ({
  DocumentView: forwardRef(function DocumentViewStub(props: Record<string, unknown>, ref) {
    h.docProps = props;
    useImperativeHandle(ref, () => ({ wrapCommand: () => h.claim }) as never);
    return <div data-testid="doc-view" />;
  }),
}));
vi.mock('./useOpenDocuments', async (orig) => {
  const actual = await orig<typeof import('./useOpenDocuments')>();
  return {
    useOpenDocuments: () => {
      const docs = actual.useOpenDocuments();
      const { open } = docs;
      useEffect(() => { if (h.seed) open(h.seed as DocumentSession); }, [open]);
      return docs;
    },
  };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested: () => Promise.resolve(() => {}), setTitle: () => Promise.resolve(), label: 'main' }),
}));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => new Promise<() => void>(() => {}) }),
}));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ listen: () => Promise.resolve(() => {}), label: 'main' }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));
vi.mock('../files/fileController', async (orig) => ({
  ...(await orig<typeof import('../files/fileController')>()),
  takePendingOpen: () => Promise.resolve(null),
  takeLaunchOpen: () => Promise.resolve(null),
  markFrontendReady: () => Promise.resolve(null),
  registerOpenPath: () => Promise.resolve(),
  releaseOpenPath: () => Promise.resolve(),
}));
vi.mock('../files/fileWatch', () => ({
  watchPath: () => Promise.resolve(), unwatchPath: () => Promise.resolve(), watcherAvailable: () => Promise.resolve(false),
}));

import { EditorWindow } from './EditorWindow';

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

async function mount(withDoc: boolean) {
  h.seed = withDoc
    ? new DocumentSession({ path: '/tmp/t.md', format: 'markdown', meta: { eol: 'lf', hadBom: false }, text: 'hi\n' })
    : null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<EditorWindow />));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

beforeEach(() => { h.toggleCodeWrap.mockClear(); h.syncWrapMenu.mockClear(); h.claim = 'code'; });
afterEach(async () => {
  if (root) { await act(async () => root!.unmount()); root = null; }
  container?.remove();
  container = null;
});

describe('View → Wrap Lines routing', () => {
  it('flips this window\'s wrapping when no document is open', async () => {
    await mount(false);
    expect(container!.querySelector('[data-testid="doc-view"]')).toBeNull();
    h.handlers.onToggleWrap();
    expect(h.toggleCodeWrap).toHaveBeenCalledTimes(1);
  });

  it('flips this window\'s wrapping in Code view', async () => {
    await mount(true);
    expect(container!.querySelector('[data-testid="doc-view"]')).not.toBeNull();
    h.claim = 'code';
    h.handlers.onToggleWrap();
    expect(h.toggleCodeWrap).toHaveBeenCalledTimes(1);
  });

  it('leaves this window\'s wrapping alone in Live view', async () => {
    await mount(true);
    h.claim = 'live';
    h.handlers.onToggleWrap();
    expect(h.toggleCodeWrap).not.toHaveBeenCalled();
  });

  it('re-reports the unchanged wrapping in Live view, because macOS already moved the checkmark', async () => {
    await mount(true);
    h.claim = 'live';
    h.handlers.onToggleWrap();
    expect(h.syncWrapMenu).toHaveBeenCalledTimes(1);
  });
});

describe('View → Wrap Lines checkmark in Live view', () => {
  it('hands the document view the hook\'s Live report, so the caret\'s code block drives the mark', async () => {
    await mount(true);
    expect(h.docProps?.onLiveWrapChange).toBe(h.reportLiveWrap);
  });
});
