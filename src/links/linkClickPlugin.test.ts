// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Node as PMNode, Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { liveSchema } from '../views/liveSchema';
import { htmlSchema } from '../views/htmlSchema';
import { linkClickPlugin, LINKS_ARMED_CLASS } from './linkClickPlugin';

// When the plugin lets a click through, ProseMirror's own mousedown handling
// maps the pointer to a position with `elementFromPoint`, which jsdom lacks.
// No layout means no hit-testing, so "nothing at that point" is the honest stub.
if (typeof document.elementFromPoint !== 'function') {
  document.elementFromPoint = () => null;
}

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view = null; document.body.innerHTML = ''; });

/** "see " + a link reading "docs" + " here", in either schema. */
function linkDoc(schema: Schema, linkAttrs: Record<string, unknown>): PMNode {
  const link = schema.marks.link.create(linkAttrs);
  return schema.node('doc', null, [
    schema.node('paragraph', { blockId: 'b0' }, [
      schema.text('see '), schema.text('docs', [link]), schema.text(' here'),
    ]),
  ]);
}

const CASES = [
  { label: 'Markdown', doc: () => linkDoc(liveSchema, { href: 'https://example.com/docs' }) },
  { label: 'HTML', doc: () => linkDoc(htmlSchema, { htmlAttrs: { href: 'https://example.com/docs' } }) },
];

function mount(doc: PMNode, canOpen?: (href: string) => boolean) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const onOpen = vi.fn();
  const onHover = vi.fn();
  view = new EditorView(host, {
    state: EditorState.create({ doc, plugins: [linkClickPlugin(() => ({ onOpen, onHover, canOpen }))] }),
  });
  // Park the caret at the very start so a moved selection is detectable.
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
  const anchor = view.dom.querySelector('a')!;
  const plain = view.dom.querySelector('p')!;
  return { view, host, onOpen, onHover, anchor, plain };
}

function mouse(target: Element, type: string, init: MouseEventInit = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(e);
  return e;
}

describe.each(CASES)('linkClickPlugin — $label', ({ doc }) => {
  it('⌘-click on a link opens it and leaves the caret where it was', () => {
    const { view: v, onOpen, anchor } = mount(doc());
    const before = v.state.selection.from;
    const down = mouse(anchor, 'mousedown', { metaKey: true });
    mouse(anchor, 'mouseup', { metaKey: true });
    const click = mouse(anchor, 'click', { metaKey: true });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith('https://example.com/docs');
    expect(down.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(v.state.selection.from).toBe(before);
  });

  it('a plain click on a link does not open it', () => {
    const { onOpen, anchor } = mount(doc());
    const down = mouse(anchor, 'mousedown');
    mouse(anchor, 'click');
    expect(onOpen).not.toHaveBeenCalled();
    expect(down.defaultPrevented).toBe(false);
  });

  it('⌘-click outside a link does nothing special', () => {
    const { onOpen, plain } = mount(doc());
    const down = mouse(plain, 'mousedown', { metaKey: true });
    expect(onOpen).not.toHaveBeenCalled();
    expect(down.defaultPrevented).toBe(false);
  });

  it('a right-button ⌘-click does not open', () => {
    const { onOpen, anchor } = mount(doc());
    mouse(anchor, 'mousedown', { metaKey: true, button: 2 });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('reports the hovered link once, then null when the pointer leaves it', () => {
    const { view: v, onHover, anchor, plain } = mount(doc());
    mouse(anchor, 'mousemove');
    mouse(anchor, 'mousemove');
    expect(onHover.mock.calls).toEqual([['https://example.com/docs']]);
    mouse(plain, 'mousemove');
    expect(onHover).toHaveBeenLastCalledWith(null);
    mouse(anchor, 'mousemove');
    v.dom.dispatchEvent(new MouseEvent('mouseleave'));
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('marks the editor while ⌘ is held over a link, and clears it on release or when the window loses focus', () => {
    const { host, anchor } = mount(doc());
    mouse(anchor, 'mousemove');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
    expect(host.classList.contains(LINKS_ARMED_CLASS)).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', metaKey: false }));
    expect(host.classList.contains(LINKS_ARMED_CLASS)).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
    window.dispatchEvent(new Event('blur'));
    expect(host.classList.contains(LINKS_ARMED_CLASS)).toBe(false);
  });

  it('shows the hand only over a link that will open, whichever of ⌘ and the pointer arrives first', () => {
    const { host, anchor, plain } = mount(doc(), () => true);
    mouse(anchor, 'mousemove', { metaKey: true });
    expect(host.classList.contains(LINKS_ARMED_CLASS)).toBe(true);
    mouse(plain, 'mousemove', { metaKey: true });
    expect(host.classList.contains(LINKS_ARMED_CLASS)).toBe(false);
    mouse(anchor, 'mousemove');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
    expect(host.classList.contains(LINKS_ARMED_CLASS)).toBe(true);
  });

  it('never shows the hand over a link that will not open', () => {
    const { host, anchor } = mount(doc(), () => false);
    mouse(anchor, 'mousemove', { metaKey: true });
    expect(host.classList.contains(LINKS_ARMED_CLASS)).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
    expect(host.classList.contains(LINKS_ARMED_CLASS)).toBe(false);
  });

  it('clears the hover when the editor goes away', () => {
    const { view: v, onHover, anchor } = mount(doc());
    mouse(anchor, 'mousemove');
    v.destroy();
    view = null;
    expect(onHover).toHaveBeenLastCalledWith(null);
  });
});

describe('linkClickPlugin — the address comes from the document, not the rendered page', () => {
  it('passes on a script link the HTML render stripped, so it is refused rather than reported as empty', () => {
    const { onOpen, anchor } = mount(linkDoc(htmlSchema, { htmlAttrs: { href: 'javascript:alert(1)' } }));
    expect(anchor.hasAttribute('href')).toBe(false);
    mouse(anchor, 'mousedown', { metaKey: true });
    expect(onOpen).toHaveBeenCalledWith('javascript:alert(1)');
  });
});
