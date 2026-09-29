// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { linkAtPos, codeLinkExtension } from './codeLinks';
import { LINKS_ARMED_CLASS } from './linkPointer';

// jsdom has Element.getClientRects but not the Range version CodeMirror's
// coordsAtPos uses. Empty rects: no layout, so no position to report.
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function () { return [] as unknown as DOMRectList; };
  Range.prototype.getBoundingClientRect = function () { return new DOMRect(); };
}

const md = (doc: string) => {
  const state = EditorState.create({ doc, extensions: [markdown({ addKeymap: false })] });
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
};
const htm = (doc: string) => {
  const state = EditorState.create({ doc, extensions: [html({ autoCloseTags: false })] });
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
};
/** linkAtPos at the first occurrence of `marker` in the document, plus `offset`. */
const at = (state: EditorState, marker: string, offset = 0) =>
  linkAtPos(state, state.doc.toString().indexOf(marker) + offset);

describe('linkAtPos — Markdown', () => {
  const s = md('See [the docs](https://a.com "Title") or <https://b.com> or ![pic](p.png). Plain https://c.com text.');

  it('finds the address from anywhere on a [text](address) link', () => {
    expect(at(s, 'the docs')).toBe('https://a.com');
    expect(at(s, 'a.com')).toBe('https://a.com');
    expect(at(s, 'Title')).toBe('https://a.com');
  });

  it('finds an <address> autolink', () => {
    expect(at(s, 'b.com')).toBe('https://b.com');
  });

  it('finds a picture\'s address too, so it gets an honest hint rather than silence', () => {
    expect(at(s, 'pic')).toBe('p.png');
  });

  it('finds nothing in plain text, including a bare address the view does not treat as a link', () => {
    expect(at(s, 'See')).toBeNull();
    expect(at(s, 'c.com')).toBeNull();
  });

  it('finds nothing for a reference-style link, which has no address of its own', () => {
    expect(at(md('A [ref link][r] here.\n\n[r]: https://r.com\n'), 'ref link')).toBeNull();
  });
});

describe('linkAtPos — HTML', () => {
  const s = htm('<p>Go <a class="btn" href="https://a.com">there</a> or <link href="style.css"> <a href=\'b.html\'>b</a> <a href=c.md>c</a></p>');

  it('finds the href from anywhere in an <a> opening tag', () => {
    expect(at(s, 'a.com')).toBe('https://a.com');
    expect(at(s, 'class')).toBe('https://a.com');
    expect(at(s, '<a class', 1)).toBe('https://a.com');
  });

  it('strips single quotes and accepts an unquoted value', () => {
    expect(at(s, 'b.html')).toBe('b.html');
    expect(at(s, 'c.md')).toBe('c.md');
  });

  it('finds nothing in the link text or in another tag\'s href', () => {
    expect(at(s, 'there')).toBeNull();
    expect(at(s, 'style.css')).toBeNull();
    expect(at(s, 'Go')).toBeNull();
  });

  it('finds nothing on an <a> without an href', () => {
    expect(at(htm('<a name="top">x</a>'), 'name')).toBeNull();
  });
});

describe('codeLinkExtension', () => {
  let view: EditorView | null = null;
  afterEach(() => { view?.destroy(); view = null; document.body.innerHTML = ''; });

  /** Mounts a view and points every pointer event at `marker` — jsdom has no layout to hit-test. */
  function mount(doc: string, marker: string, canOpen?: (href: string) => boolean) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onOpen = vi.fn();
    const onHover = vi.fn();
    // Registered after the link extension, and CodeMirror's own mouse handling
    // (which adds the ⌘-click cursor) runs after both. So the probe firing
    // means the link extension passed the event on to the editor, and the
    // probe NOT firing means no cursor can have been added. jsdom has no
    // layout, so CodeMirror cannot add the cursor itself here to be observed.
    const reachedEditor = vi.fn(() => false);
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc,
        extensions: [
          markdown({ addKeymap: false }),
          codeLinkExtension(() => ({ onOpen, onHover, canOpen })),
          EditorView.domEventHandlers({ mousedown: reachedEditor }),
        ],
      }),
    });
    ensureSyntaxTree(view.state, doc.length, 5000);
    let target = doc.indexOf(marker);
    view.posAtCoords = (() => target) as EditorView['posAtCoords'];
    const pointAt = (m: string) => { target = doc.indexOf(m); };
    const mouse = (type: string, init: MouseEventInit = {}) => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 1, clientY: 1, ...init });
      view!.contentDOM.dispatchEvent(e);
      return e;
    };
    return { view, host, onOpen, onHover, pointAt, mouse, reachedEditor };
  }

  const DOC = 'See [docs](https://a.com) here.';

  it('⌘-click on a link opens it and keeps the editor from adding a cursor', () => {
    const { onOpen, mouse, reachedEditor } = mount(DOC, 'docs');
    const down = mouse('mousedown', { metaKey: true });
    expect(onOpen).toHaveBeenCalledWith('https://a.com');
    expect(down.defaultPrevented).toBe(true);
    expect(reachedEditor).not.toHaveBeenCalled();
  });

  it('⌘-click away from a link is left to the editor, so it still adds a cursor', () => {
    const { onOpen, mouse, reachedEditor } = mount(DOC, 'here');
    mouse('mousedown', { metaKey: true });
    expect(onOpen).not.toHaveBeenCalled();
    expect(reachedEditor).toHaveBeenCalledTimes(1);
  });

  it('a plain click on a link does not open it', () => {
    const { onOpen, mouse } = mount(DOC, 'docs');
    mouse('mousedown');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('reports the hovered link, and null off it and on leaving', () => {
    const { onHover, pointAt, mouse, view: v } = mount(DOC, 'docs');
    mouse('mousemove');
    expect(onHover).toHaveBeenLastCalledWith('https://a.com');
    pointAt('here');
    mouse('mousemove');
    expect(onHover).toHaveBeenLastCalledWith(null);
    pointAt('docs');
    mouse('mousemove');
    v.contentDOM.dispatchEvent(new MouseEvent('mouseleave'));
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('shows the hand only while ⌘ is held over a link that will open', () => {
    const open = mount(DOC, 'docs', () => true);
    open.mouse('mousemove', { metaKey: true });
    expect(open.host.classList.contains(LINKS_ARMED_CLASS)).toBe(true);
    open.view.destroy(); view = null;

    const refused = mount(DOC, 'docs', () => false);
    refused.mouse('mousemove', { metaKey: true });
    expect(refused.host.classList.contains(LINKS_ARMED_CLASS)).toBe(false);
  });
});
