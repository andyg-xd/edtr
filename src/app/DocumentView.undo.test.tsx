// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, createRef } from 'react';
import { EditorView as CMEditorView } from '@codemirror/view';
import { DocumentView, type DocumentViewHandle } from './DocumentView';
import { DocumentSession } from '../files/documentSession';
import { formatForPath } from '../files/fileTypes';
import type { OpenDoc, ViewMode } from '../files/openDocuments';
import { MODES_OFF } from '../settings/writingModes';

// Same jsdom accommodations as DocumentView.find.test.tsx, for the same reasons:
// no Tauri webview, no Range.getClientRects, and no document.execCommand for
// ProseMirror's Safari shadow-DOM path (jsdom claims to be Apple).
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
});

// Bytes no editor would reproduce on its own: CRLF, trailing spaces, a
// hand-aligned table and doubled blank lines. Restoring them exactly is the
// whole point of storing text rather than re-deriving it.
const MD = '# Title\r\n\r\nalpha   with  odd   spacing  \r\n\r\n\r\n| a   | bb |\r\n|-----|----|\r\n| ccc | d  |\r\n';
const HTML = '<!doctype html>\n<html>\n  <head><style>  p { color: red }  </style></head>\n  <body>\n    <p>alpha   text</p>\n\n\n    <p>second</p>\n  </body>\n</html>\n';

interface Mounted {
  ref: React.RefObject<DocumentViewHandle | null>;
  onInfo: ReturnType<typeof vi.fn>;
  show: (doc: OpenDoc, key?: string) => Promise<void>;
}

function makeDoc(id: string, path: string, text: string, viewMode: ViewMode): OpenDoc {
  const session = new DocumentSession({ path, format: formatForPath(path), meta: { eol: 'lf', hadBom: false }, text });
  return { id, session, viewMode };
}

/** Render `doc` with DocumentView keyed the way EditorWindow keys it: the same
 * key for a Code<->Live toggle, a different one per document or reload. */
async function setup(): Promise<Mounted> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const ref = createRef<DocumentViewHandle>();
  const onInfo = vi.fn();
  const show = async (doc: OpenDoc, key = doc.id) => {
    await act(async () => root!.render(
      <DocumentView
        key={key} ref={ref} doc={doc} effectiveTheme="light" modes={MODES_OFF}
        onSetWritingMode={() => {}} onExport={() => {}}
        onDirtyChange={() => {}} onLiveAvailableChange={() => {}} onError={() => {}} onInfo={onInfo}
      />,
    ));
  };
  return { ref, onInfo, show };
}

/** A Code<->Live toggle, as EditorWindow does it: flush Live first, then flip
 * the mode on the same document. */
async function toggle(m: Mounted, doc: OpenDoc, to: ViewMode): Promise<OpenDoc> {
  if (doc.viewMode === 'live') expect(m.ref.current!.flushToSource()).toBe(true);
  const next = { ...doc, viewMode: to };
  await m.show(next);
  return next;
}

function pmDom(): HTMLElement {
  const shadow = container!.querySelector('.html-live-view')?.shadowRoot;
  return (shadow ?? container!).querySelector<HTMLElement>('.ProseMirror')!;
}
const cm = () => CMEditorView.findFromDOM(container!.querySelector('.cm-editor') as HTMLElement)!;

/** The Edit menu's Undo / Redo, as WebKit delivers it. */
async function menu(target: HTMLElement, inputType: 'historyUndo' | 'historyRedo') {
  await act(async () => {
    target.dispatchEvent(new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true }));
  });
}
const undoIn = (view: ViewMode) => menu(view === 'code' ? cm().contentDOM : pmDom(), 'historyUndo');
const redoIn = (view: ViewMode) => menu(view === 'code' ? cm().contentDOM : pmDom(), 'historyRedo');

async function typeInCode(text: string) {
  await act(async () => {
    const v = cm();
    v.dispatch({ changes: { from: v.state.doc.length, insert: text }, userEvent: 'input.type' });
  });
}

/** A real Live edit: Replace All through the find bar, the same path a person
 * uses, so it lands as a ProseMirror transaction that marks a block dirty. */
async function replaceAllInLive(m: Mounted, find: string, replace: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  const set = async (sel: string, value: string) => act(async () => {
    const el = container!.querySelector<HTMLInputElement>(sel)!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { m.ref.current!.openReplace(); });
  await set('.find-input', find);
  await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
  await set('.find-replace-input', replace);
  await act(async () => { container!.querySelector<HTMLButtonElement>('.find-replace-all')!.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
}

describe('DocumentView — undo across the Code ↔ Live switch', () => {
  it('Code → Live → Undo restores the exact bytes from before the Code edits, and Redo brings them back', async () => {
    const m = await setup();
    let doc = makeDoc('d', '/tmp/u.md', MD, 'code');
    await m.show(doc);
    await typeInCode('more text\n');
    const edited = doc.session.text;
    expect(edited).not.toBe(MD);

    doc = await toggle(m, doc, 'live');
    await undoIn('live');
    expect(doc.session.text).toBe(MD);
    expect(m.onInfo).toHaveBeenLastCalledWith('Undid everything you changed in Code view.');

    await redoIn('live');
    expect(doc.session.text).toBe(edited);
    expect(m.onInfo).toHaveBeenLastCalledWith('Redid your changes from Code view.');
  });

  it.each([
    { label: 'Markdown', path: '/tmp/u.md', text: MD },
    { label: 'HTML', path: '/tmp/u.html', text: HTML },
  ])('$label Live → Code → Undo restores the exact bytes from before the Live edits', async ({ path, text }) => {
    const m = await setup();
    let doc = makeDoc('d', path, text, 'live');
    await m.show(doc);
    await replaceAllInLive(m, 'alpha', 'omega');
    doc = await toggle(m, doc, 'code');
    expect(doc.session.text).toContain('omega');

    await undoIn('code');
    expect(doc.session.text).toBe(text);
    expect(m.onInfo).toHaveBeenLastCalledWith('Undid everything you changed in Live view.');
  });

  it("uses the editor's own steps before stepping back across the switch", async () => {
    const m = await setup();
    let doc = makeDoc('d', '/tmp/u.md', MD, 'live');
    await m.show(doc);
    await replaceAllInLive(m, 'alpha', 'omega');
    doc = await toggle(m, doc, 'code');
    const afterLive = doc.session.text;
    await typeInCode('typed in code\n');

    await undoIn('code');
    expect(doc.session.text).toBe(afterLive);
    // Replace All reports its own count through the same notice, so look only
    // for an undo notice.
    expect(m.onInfo.mock.calls.flat().some((msg) => String(msg).startsWith('Undid'))).toBe(false);

    await undoIn('code');
    expect(doc.session.text).toBe(MD);
  });

  it('a new edit after an undo clears redo', async () => {
    const m = await setup();
    let doc = makeDoc('d', '/tmp/u.md', MD, 'code');
    await m.show(doc);
    await typeInCode('first\n');
    doc = await toggle(m, doc, 'live');
    doc = await toggle(m, doc, 'code');
    await undoIn('code');
    expect(doc.session.text).toBe(MD);

    await typeInCode('different\n');
    const typed = doc.session.text;
    await undoIn('code'); // the editor's own step: the typing
    await redoIn('code'); // the editor's own redo: the typing back
    await redoIn('code'); // nothing left — the old redo must not replace the typing
    expect(doc.session.text).toBe(typed);
  });

  it('survives switching to another document and back', async () => {
    const m = await setup();
    let a = makeDoc('a', '/tmp/a.md', MD, 'code');
    const b = makeDoc('b', '/tmp/b.md', 'other\n', 'code');
    await m.show(a);
    await typeInCode('edit in a\n');
    a = await toggle(m, a, 'live');
    await m.show(b);
    await m.show(a);

    await undoIn('live');
    expect(a.session.text).toBe(MD);
  });

  it('is cleared by a reload from disk', async () => {
    const m = await setup();
    let doc = makeDoc('d', '/tmp/u.md', MD, 'code');
    await m.show(doc);
    await typeInCode('edit\n');
    doc = await toggle(m, doc, 'live');

    doc.session.reload({ path: '/tmp/u.md', format: 'markdown', meta: { eol: 'lf', hadBom: false }, text: 'from disk\n' });
    await m.show(doc, 'd:reloaded'); // EditorWindow remounts on reload
    await undoIn('live');
    expect(doc.session.text).toBe('from disk\n');
    expect(m.onInfo).not.toHaveBeenCalled();
  });

  it('a switch with no changes records nothing', async () => {
    const m = await setup();
    let doc = makeDoc('d', '/tmp/u.md', MD, 'code');
    await m.show(doc);
    doc = await toggle(m, doc, 'live');
    doc = await toggle(m, doc, 'code');
    await undoIn('code');
    expect(doc.session.text).toBe(MD);
    expect(m.onInfo).not.toHaveBeenCalled();
  });

  it('a Replace All in Live, hand-aligned table included, is undone by one ⌘Z to the exact bytes', async () => {
    // Backs the Replace All dialog's "You can undo this with ⌘Z." Undo has to
    // un-mark the blocks too, or saving would re-space the table anyway.
    const text = 'alpha  one\r\n\r\n| alpha | b |\r\n|-------|---|\r\n| c     | alpha |\r\n';
    const m = await setup();
    const doc = makeDoc('d', '/tmp/u.md', text, 'live');
    await m.show(doc);
    await replaceAllInLive(m, 'alpha', 'z');
    await undoIn('live');
    expect(m.ref.current!.flushToSource()).toBe(true);
    expect(doc.session.text).toBe(text);
  });

  describe('keyboard focus after the editor is rebuilt', () => {
    // A rebuilt editor that leaves focus on the page sends the next ⌘Z to the
    // menu, where it does nothing (owner's C4 check, confirmed by trace).
    const editorHasFocus = () => {
      const a = document.activeElement;
      return !!a && (!!a.closest('.cm-editor') || !!a.closest('.ProseMirror') || !!a.closest('.html-live-view'));
    };

    it('goes to the rebuilt editor after a whole-view step', async () => {
      const m = await setup();
      let doc = makeDoc('d', '/tmp/u.md', MD, 'live');
      await m.show(doc);
      await replaceAllInLive(m, 'alpha', 'omega');
      doc = await toggle(m, doc, 'code');
      await act(async () => { cm().focus(); });
      await undoIn('code');
      expect(doc.session.text).toBe(MD);
      expect(editorHasFocus()).toBe(true);
    });

    it('goes to the new editor after a switch, when nothing else has it', async () => {
      const m = await setup();
      let doc = makeDoc('d', '/tmp/u.md', MD, 'code');
      await m.show(doc);
      await act(async () => { cm().focus(); });
      doc = await toggle(m, doc, 'live');
      expect(editorHasFocus()).toBe(true);
      doc = await toggle(m, doc, 'code');
      expect(editorHasFocus()).toBe(true);
    });

    it('is not taken from the find field', async () => {
      const m = await setup();
      let doc = makeDoc('d', '/tmp/u.md', MD, 'code');
      await m.show(doc);
      await act(async () => { m.ref.current!.openFind(); });
      const field = container!.querySelector<HTMLInputElement>('.find-input')!;
      await act(async () => { field.focus(); });
      doc = await toggle(m, doc, 'live');
      expect(document.activeElement).toBe(container!.querySelector('.find-input'));
    });
  });

  describe('historyStep — the Edit menu, from wherever focus is', () => {
    const blur = () => act(async () => { (document.activeElement as HTMLElement | null)?.blur(); });

    it("takes the editor's own steps first, then the whole-view step", async () => {
      const m = await setup();
      let doc = makeDoc('d', '/tmp/u.md', MD, 'live');
      await m.show(doc);
      await replaceAllInLive(m, 'alpha', 'omega');
      doc = await toggle(m, doc, 'code');
      const afterLive = doc.session.text;
      await typeInCode('typed\n');
      await blur();

      await act(async () => { m.ref.current!.historyStep('undo'); });
      expect(doc.session.text).toBe(afterLive);
      await act(async () => { m.ref.current!.historyStep('undo'); });
      expect(doc.session.text).toBe(MD);
      await act(async () => { m.ref.current!.historyStep('redo'); });
      expect(doc.session.text).toBe(afterLive);
    });

    it('undoes a whole Replace All in one step with focus left on the find bar', async () => {
      const m = await setup();
      const doc = makeDoc('d', '/tmp/u.md', MD, 'live');
      await m.show(doc);
      await replaceAllInLive(m, 'alpha', 'omega');
      await blur();
      await act(async () => { m.ref.current!.historyStep('undo'); });
      expect(m.ref.current!.flushToSource()).toBe(true);
      expect(doc.session.text).toBe(MD);
    });

    it('puts focus back in the editor', async () => {
      const m = await setup();
      const doc = makeDoc('d', '/tmp/u.md', MD, 'code');
      await m.show(doc);
      await typeInCode('x');
      await blur();
      await act(async () => { m.ref.current!.historyStep('undo'); });
      expect(document.activeElement?.closest('.cm-editor')).not.toBeNull();
    });
  });
});

