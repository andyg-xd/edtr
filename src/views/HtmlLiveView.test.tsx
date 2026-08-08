// @vitest-environment jsdom
import {
  describe, it, expect, afterEach, vi,
} from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { EditorState, TextSelection } from 'prosemirror-state';
import { HtmlLiveView } from './HtmlLiveView';
import { toLiveHtml } from './htmlModel';
import { htmlSchema } from './htmlSchema';
import { blockIdentityPlugin } from './blockIdentity';
import { splitCommand } from '../commands/htmlStructureCommands';
import { sinkListItemCmd } from '../commands/htmlBlockCommands';
import { goToNextCell } from '../commands/htmlTableCommands';

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

async function render(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return container!;
}

describe('HtmlLiveView', () => {
  it('renders the doc inside a shadow root with the CSS injected', async () => {
    const res = toLiveHtml('<html><head><style>.lead{color:red}</style></head><body><p class="lead">hi</p></body></html>');
    if (!res.ok) throw new Error('expected ok');
    const c = await render(<HtmlLiveView doc={res.doc} styleText={res.styleText} />);
    const host = c.querySelector('.html-live-view') as HTMLElement;
    expect(host.shadowRoot).toBeTruthy();
    const shadow = host.shadowRoot!;
    expect(shadow.querySelector('style:not([data-edtr-defaults]):not([data-edtr-affordance])')?.textContent).toContain('.lead{color:red}');
    // the paragraph rendered with its class, inside the shadow root (now nested
    // under the reconstructed html/body scaffold — descendant selector still finds it)
    expect(shadow.querySelector('p.lead')?.textContent).toBe('hi');
  });

  it('injects a browser-default reset FIRST (before the file style) so a light-styled file stays readable in dark mode', async () => {
    // The shadow scaffold inherits Edtr's themed color/color-scheme across the
    // host boundary; in dark mode a light-styled file's dark text then sat on a
    // dark inherited context (unreadable). A low-specificity reset restores the
    // browser-default canvas/text, overridable by the file's own CSS by source
    // order. jsdom can't compute the cascade, so assert structure: reset present,
    // FIRST, and contains the background/color/color-scheme defaults.
    const res = toLiveHtml('<html><head><style>.lead{color:red}</style></head><body><p class="lead">hi</p></body></html>');
    if (!res.ok) throw new Error('expected ok');
    const c = await render(<HtmlLiveView doc={res.doc} styleText={res.styleText} />);
    const shadow = (c.querySelector('.html-live-view') as HTMLElement).shadowRoot!;
    const defaults = shadow.querySelector('style[data-edtr-defaults]');
    expect(defaults).not.toBeNull();
    expect(defaults!.textContent).toContain('background-color');
    expect(defaults!.textContent).toContain('color:#000');
    expect(defaults!.textContent).toContain('color-scheme:light');
    // Regression guard: the opaque canvas must live on :host ONLY. If html/body
    // are given an opaque background, a dark file that themes only html/:root
    // renders its light text on forced white (unreadable). Cascade verified in a
    // real browser; jsdom can't compute it, so lock the structural invariant.
    expect(defaults!.textContent).toContain(':host{');
    expect(defaults!.textContent).not.toMatch(/(?:^|})\s*(?:html|body)[^{}]*\{[^{}]*background/i);
    // Lowest priority: it is the FIRST stylesheet, before the file style.
    const styles = Array.from(shadow.querySelectorAll('style'));
    const defIdx = styles.findIndex((s) => s.hasAttribute('data-edtr-defaults'));
    const fileIdx = styles.findIndex((s) => (s.textContent ?? '').includes('.lead{color:red}'));
    expect(defIdx).toBe(0);
    expect(defIdx).toBeLessThan(fileIdx);
  });

  it('runs the canvas-propagation sync at mount (sets an explicit color-scheme on the host)', async () => {
    // jsdom can't compute the page background (the dark/light propagation is
    // verified in a real browser + GUI QA), but the sync always sets an explicit
    // color-scheme on the host — proving it ran, and with no page background it
    // defaults to light. Guards against the sync being dropped.
    const res = toLiveHtml('<html><body><p>x</p></body></html>');
    if (!res.ok) throw new Error('expected ok');
    const c = await render(<HtmlLiveView doc={res.doc} styleText="" />);
    const host = c.querySelector('.html-live-view') as HTMLElement;
    expect(host.style.getPropertyValue('color-scheme')).toBe('light');
  });

  it('does NOT inject the affordance stylesheet in read-only render (fidelity preserved)', async () => {
    const r = toLiveHtml('<html><body><table><tr><td>a</td></tr></table></body></html>');
    if (!r.ok) throw new Error(r.reason);
    const c = await render(<HtmlLiveView doc={r.doc} styleText={r.styleText} />);
    const shadow = (c.querySelector('.html-live-view') as HTMLElement).shadowRoot!;
    expect(shadow.querySelector('style[data-edtr-affordance]')).toBeNull();
  });

  it('reconstructs an html/body scaffold (with source attrs) so body/html-scoped CSS matches', async () => {
    const res = toLiveHtml('<html class="h"><body class="dark" id="pg"><p>x</p></body></html>');
    if (!res.ok) throw new Error('expected ok');
    const c = await render(
      <HtmlLiveView
        doc={res.doc}
        styleText="body.dark{color:red}"
        bodyAttrs={res.bodyAttrs}
        rootAttrs={res.rootAttrs}
      />,
    );
    const host = c.querySelector('.html-live-view') as HTMLElement;
    const shadow = host.shadowRoot!;
    // Structural assertions: this is what makes `body.dark{}` / `html.h{}`
    // selectors match in a real browser. (`:root` doesn't match inside a shadow
    // tree — those rules are rewritten to `:host`; see the next test.) jsdom
    // doesn't fully compute the cascade, so actual color application is verified
    // in manual GUI QA.
    expect(shadow.querySelector('style:not([data-edtr-defaults]):not([data-edtr-affordance])')?.textContent).toContain('body.dark{color:red}');
    expect(shadow.querySelector('html.h')).toBeTruthy();
    expect(shadow.querySelector('body.dark')).toBeTruthy();
    expect(shadow.querySelector('body.dark p')?.textContent).toBe('x');
  });

  it('rewrites :root selectors to :host so page custom properties apply in the shadow tree', async () => {
    const res = toLiveHtml('<html><body><p>x</p></body></html>');
    if (!res.ok) throw new Error('expected ok');
    const c = await render(
      <HtmlLiveView doc={res.doc} styleText=":root{--accent:red} body{color:var(--accent)}" />,
    );
    const host = c.querySelector('.html-live-view') as HTMLElement;
    const css = host.shadowRoot!.querySelector('style:not([data-edtr-defaults]):not([data-edtr-affordance])')?.textContent ?? '';
    // The rewrite must happen: `:root` never matches inside a shadow tree, but
    // `:host` (the shadow host) does, and custom properties declared there
    // inherit down into html/body/content. The computed-cascade effect (var()
    // resolving to red) is GUI-verified; jsdom can't compute var().
    expect(css).toContain(':host{--accent:red}');
    expect(css).not.toContain(':root');
  });

  it('injects find-highlight CSS AFTER the file style, using tokens not literals', async () => {
    // A highlight the file's own CSS can override is no highlight at all — and
    // findbar.css cannot cross the shadow boundary, hence the injection.
    const res = toLiveHtml('<html><body><p>hi</p></body></html>');
    if (!res.ok) throw new Error('expected ok');
    const c = await render(<HtmlLiveView doc={res.doc} styleText="p { color: red }" />);
    const shadow = (c.querySelector('.html-live-view') as HTMLElement).shadowRoot!;
    const styles = Array.from(shadow.querySelectorAll('style'));
    const findIndex = styles.findIndex((s) => s.hasAttribute('data-edtr-find'));
    const fileIndex = styles.findIndex((s) => (s.textContent ?? '').includes('color: red'));
    expect(findIndex).toBeGreaterThan(fileIndex);
    expect(styles[findIndex].textContent).toContain('var(--find-match-bg)');
    expect(styles[findIndex].textContent).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  });

  it('neutralises file CSS that would drag the highlight out of the text flow', async () => {
    // Injecting LAST is not enough, and the original comment here was wrong to
    // imply it was: source order only decides between rules of EQUAL
    // specificity. A real file carried
    // `ul.notice li span{position:absolute;left:14px;top:11px;font-weight:800}`
    // to place a `→` bullet; at (0,1,3) it beat `.edtr-find` (0,1,0) outright,
    // absolutely positioned the highlighted word over the arrow and removed it
    // from its sentence. The element name is the primary defence; these
    // declarations are the backstop for a file that reaches our element anyway
    // (`li *`, say). jsdom computes no cascade, let alone one across a shadow
    // boundary, so this asserts the contract in the stylesheet text.
    const res = toLiveHtml('<html><body><p>hi</p></body></html>');
    if (!res.ok) throw new Error('expected ok');
    const c = await render(<HtmlLiveView doc={res.doc} styleText="p { color: red }" />);
    const shadow = (c.querySelector('.html-live-view') as HTMLElement).shadowRoot!;
    const css = Array.from(shadow.querySelectorAll('style'))
      .find((s) => s.hasAttribute('data-edtr-find'))?.textContent ?? '';
    // Scoped to our element, so none of this can leak onto the file's content.
    expect(css).toContain('edtr-mark');
    for (const decl of ['position:static', 'float:none', 'display:inline', 'font:inherit']) {
      expect(css).toContain(`${decl}!important`);
    }
  });
});

type MountedRoot = { container: HTMLDivElement; root: ReturnType<typeof createRoot> };
const mounted: MountedRoot[] = [];

function mount(ui: ReactElement) {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  act(() => { root.render(ui); });
  mounted.push({ container: c, root });
  return { container: c, root };
}

describe('HtmlLiveView — editable (4b)', () => {
  afterEach(() => {
    // Each test mounts a live ProseMirror EditorView + shadow root via
    // mount(); unmount + detach so they don't leak across tests.
    for (const { container: c, root } of mounted.splice(0)) {
      act(() => { root.unmount(); });
      c.remove();
    }
  });

  it('mounts an editable ProseMirror view inside the shadow root', () => {
    const r = toLiveHtml('<html><body><p>hi</p></body></html>');
    if (!r.ok) throw new Error(r.reason);
    let view: any = null;
    const { container: c } = mount(
      <HtmlLiveView doc={r.doc} styleText={r.styleText} editable onViewReady={(v) => { view = v; }} />,
    );
    const shadow = c.querySelector('.html-live-view')!.shadowRoot!;
    expect(shadow.querySelector('.ProseMirror')).not.toBeNull();
    expect(view).not.toBeNull();
    expect(view.editable).toBe(true);
  });

  it('injects an edit-only table affordance stylesheet BEFORE the file style when editable', () => {
    const r = toLiveHtml('<html><head><style>.lead{color:red}</style></head><body><p class="lead">hi</p></body></html>');
    if (!r.ok) throw new Error(r.reason);
    const { container: c } = mount(
      <HtmlLiveView doc={r.doc} styleText={r.styleText} editable onViewReady={() => {}} />,
    );
    const shadow = c.querySelector('.html-live-view')!.shadowRoot!;
    const styles = Array.from(shadow.querySelectorAll('style'));
    const affordance = shadow.querySelector('style[data-edtr-affordance]');
    expect(affordance).not.toBeNull();
    // faint cell borders + a clickable min size for empty cells
    expect(affordance!.textContent).toContain('td');
    expect(affordance!.textContent).toContain('border');
    expect(affordance!.textContent).toContain('min-width');
    // Author CSS wins: the affordance comes BEFORE the file style in source order.
    const affIdx = styles.findIndex((s) => s.hasAttribute('data-edtr-affordance'));
    const fileIdx = styles.findIndex((s) => (s.textContent ?? '').includes('.lead{color:red}'));
    expect(affIdx).toBeGreaterThanOrEqual(0);
    expect(fileIdx).toBeGreaterThanOrEqual(0);
    expect(affIdx).toBeLessThan(fileIdx);
  });

  it('injects the browser-default reset BEFORE both the affordance and the file style when editable', () => {
    const r = toLiveHtml('<html><head><style>.lead{color:red}</style></head><body><p class="lead">hi</p></body></html>');
    if (!r.ok) throw new Error(r.reason);
    const { container: c } = mount(
      <HtmlLiveView doc={r.doc} styleText={r.styleText} editable onViewReady={() => {}} />,
    );
    const shadow = c.querySelector('.html-live-view')!.shadowRoot!;
    const styles = Array.from(shadow.querySelectorAll('style'));
    const defIdx = styles.findIndex((s) => s.hasAttribute('data-edtr-defaults'));
    const affIdx = styles.findIndex((s) => s.hasAttribute('data-edtr-affordance'));
    const fileIdx = styles.findIndex((s) => (s.textContent ?? '').includes('.lead{color:red}'));
    expect(defIdx).toBe(0); // lowest priority of all stylesheets
    expect(defIdx).toBeLessThan(affIdx);
    expect(affIdx).toBeLessThan(fileIdx);
  });

  it('reports edits with dirty block ids via onEdit', () => {
    const r = toLiveHtml('<html><body><p>hi</p></body></html>');
    if (!r.ok) throw new Error(r.reason);
    let view: any = null;
    let lastDirty: Set<string> | null = null;
    mount(
      <HtmlLiveView
        doc={r.doc} styleText={r.styleText} editable
        onViewReady={(v) => { view = v; }}
        onEdit={(_d, dirty) => { lastDirty = dirty; }}
      />,
    );
    act(() => { view.dispatch(view.state.tr.insertText('!', 2)); });
    expect(lastDirty).not.toBeNull();
    expect(lastDirty!.size).toBe(1);
  });

  it('allows a structural transaction (lock removed, 4d) — deleting a whole block succeeds', () => {
    const r = toLiveHtml('<html><body><p>a</p><p>b</p></body></html>');
    if (!r.ok) throw new Error(r.reason);
    let view: any = null;
    mount(
      <HtmlLiveView doc={r.doc} styleText={r.styleText} editable onViewReady={(v) => { view = v; }} />,
    );
    const firstSize = view.state.doc.child(0).nodeSize;
    act(() => { view.dispatch(view.state.tr.delete(0, firstSize)); });
    expect(view.state.doc.childCount).toBe(1); // no lock → the block is actually removed
  });

  it('fires onEdit for both a structural edit and an in-block edit', () => {
    const r = toLiveHtml('<html><body><p>a</p><p>b</p></body></html>');
    if (!r.ok) throw new Error(r.reason);
    let view: any = null;
    const onEdit = vi.fn();
    mount(
      <HtmlLiveView
        doc={r.doc} styleText={r.styleText} editable
        onViewReady={(v) => { view = v; }}
        onEdit={onEdit}
      />,
    );

    // Structural edit: deletes the whole first block — no lock, so it applies
    // and is reported.
    const firstSize = view.state.doc.child(0).nodeSize;
    act(() => { view.dispatch(view.state.tr.delete(0, firstSize)); });
    expect(view.state.doc.childCount).toBe(1);
    expect(onEdit).toHaveBeenCalledTimes(1);

    // Within-block text edit: also reported.
    act(() => { view.dispatch(view.state.tr.insertText('!', 2)); });
    expect(onEdit).toHaveBeenCalledTimes(2);
  });

  it('runs a structural split through the mounted view\'s plugin stack (blockIdentityPlugin + splitCommand)', () => {
    const r = toLiveHtml('<html><body><p>hello</p></body></html>');
    if (!r.ok) throw new Error(r.reason);
    let view: any = null;
    const onEdit = vi.fn();
    mount(
      <HtmlLiveView
        doc={r.doc} styleText={r.styleText} editable
        onViewReady={(v) => { view = v; }}
        onEdit={onEdit}
      />,
    );

    // Place the selection mid-paragraph ("he|llo") and split there, driving
    // the command through the mounted view's actual dispatch/plugin stack —
    // not a bare EditorState — so this proves keymap wiring + blockIdentityPlugin
    // + dirtyTracking all cooperate on the mounted component, not just in isolation.
    act(() => {
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(4))));
    });
    act(() => { splitCommand(view.state, view.dispatch); });

    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.doc.child(0).type.name).toBe('paragraph');
    expect(view.state.doc.child(1).type.name).toBe('paragraph');
    // blockIdentityPlugin is active in the mounted view's plugin stack: the
    // new second block gets a fresh id — the invariant htmlWriteBack relies on.
    expect((view.state.doc.child(1).attrs.blockId as string).startsWith('new-')).toBe(true);
    expect(onEdit).toHaveBeenCalled();
  });

  it('accepts a docPath prop without error (editable)', () => {
    const r = toLiveHtml('<html><body><p>hi</p></body></html>');
    if (!r.ok) throw new Error('degraded');
    const { container: c } = mount(
      <HtmlLiveView doc={r.doc} styleText="" editable docPath="/docs/note.html" />,
    );
    expect(c.querySelector('.html-live-view')).toBeTruthy();
  });

  it('accepts an onError prop without error (editable)', () => {
    // The async paste-write-failure path itself is GUI-validated (jsdom has no
    // real clipboard/file IO); this just proves the prop is wired and mounting
    // with it doesn't throw — parity with LiveView's onError prop.
    const r = toLiveHtml('<html><body><p>hi</p></body></html>');
    if (!r.ok) throw new Error('degraded');
    const { container: c } = mount(
      <HtmlLiveView doc={r.doc} styleText="" editable docPath="/docs/note.html" onError={() => {}} />,
    );
    expect(c.querySelector('.html-live-view')).toBeTruthy();
  });

  it('Tab sinks a list item into a nested sublist through the mounted view', () => {
    const r = toLiveHtml('<html><body><ul><li>one</li><li>two</li></ul></body></html>');
    if (!r.ok) throw new Error(r.reason);
    let view: any = null;
    mount(<HtmlLiveView doc={r.doc} styleText={r.styleText} editable onViewReady={(v) => { view = v; }} />);
    // cursor inside the SECOND list item
    const list = view.state.doc.child(0);
    const secondItemInner = 1 + list.firstChild.nodeSize + 1;
    act(() => { view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(secondItemInner)))); });
    act(() => { sinkListItemCmd(view.state, view.dispatch); });
    // the first item now holds its own paragraph + a nested list
    expect(view.state.doc.child(0).firstChild.childCount).toBe(2);
  });

  it('renders a <section> as editable and reports edits inside it via onEdit', () => {
    const r = toLiveHtml('<html><body><section><p>hi</p></section></body></html>');
    if (!r.ok) throw new Error(r.reason);
    let view: any = null;
    const onEdit = vi.fn();
    mount(<HtmlLiveView doc={r.doc} styleText={r.styleText} editable onViewReady={(v) => { view = v; }} onEdit={onEdit} />);
    expect(view.state.doc.child(0).type.name).toBe('container'); // section is editable, not verbatim
    // type inside the section's paragraph (position 3 ≈ inside "hi")
    act(() => { view.dispatch(view.state.tr.insertText('!', 3)); });
    expect(onEdit).toHaveBeenCalled();
    const calls = onEdit.mock.calls;
    const dirty = calls[calls.length - 1][1] as Set<string>;
    expect(dirty.size).toBe(1); // the section (top-level container) is dirty
  });

  it('renders a plain <table> as editable and Tab moves between cells (mounted view)', () => {
    const r = toLiveHtml('<html><body><table><tr><td>a</td><td>b</td></tr></table></body></html>');
    if (!r.ok) throw new Error(r.reason);
    let view: any = null;
    mount(<HtmlLiveView doc={r.doc} styleText={r.styleText} editable onViewReady={(v) => { view = v; }} />);
    expect(view.state.doc.child(0).type.name).toBe('table'); // editable, not verbatim
    // cursor into the first cell ("a" ≈ pos 4), then Tab via the command
    act(() => { view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(4)))); });
    act(() => { goToNextCell(1)(view.state, view.dispatch); });
    // walk up from the selection to confirm we're now in column 1
    let colIndex = -1;
    const $f = view.state.selection.$from;
    for (let d = $f.depth; d > 0; d--) {
      if ($f.node(d).type.name === 'tableCell') { colIndex = $f.index(d - 1); break; }
    }
    expect(colIndex).toBe(1);
  });
});

// Structural editing: a split through a state with blockIdentityPlugin yields
// two top-level blocks with DISTINCT ids (the 2nd is a fresh new-N), the
// invariant htmlWriteBack relies on.
it('a split assigns the second block a fresh id (blockIdentityPlugin)', () => {
  const res = toLiveHtml('<html><body><p>hello</p></body></html>');
  if (!res.ok) throw new Error('degraded');
  let state = EditorState.create({ doc: res.doc, schema: htmlSchema, plugins: [blockIdentityPlugin()] });
  state = state.apply(state.tr.setSelection(TextSelection.near(res.doc.resolve(4))));
  splitCommand(state, (tr) => { state = state.apply(tr); });
  expect(state.doc.childCount).toBe(2);
  const id0 = state.doc.child(0).attrs.blockId as string;
  const id1 = state.doc.child(1).attrs.blockId as string;
  expect(id0).toBe('h0');
  expect(id1).not.toBe('h0');
  expect(id1.startsWith('new-')).toBe(true);
  expect(state.doc.child(1).attrs.srcFrom).toBe(0); // cleared range
});
