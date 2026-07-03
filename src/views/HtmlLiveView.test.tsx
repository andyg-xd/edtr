// @vitest-environment jsdom
import {
  describe, it, expect, afterEach, vi,
} from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { HtmlLiveView } from './HtmlLiveView';
import { toLiveHtml } from './htmlModel';

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
    expect(shadow.querySelector('style')?.textContent).toContain('.lead{color:red}');
    // the paragraph rendered with its class, inside the shadow root (now nested
    // under the reconstructed html/body scaffold — descendant selector still finds it)
    expect(shadow.querySelector('p.lead')?.textContent).toBe('hi');
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
    expect(shadow.querySelector('style')?.textContent).toContain('body.dark{color:red}');
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
    const css = host.shadowRoot!.querySelector('style')?.textContent ?? '';
    // The rewrite must happen: `:root` never matches inside a shadow tree, but
    // `:host` (the shadow host) does, and custom properties declared there
    // inherit down into html/body/content. The computed-cascade effect (var()
    // resolving to red) is GUI-verified; jsdom can't compute var().
    expect(css).toContain(':host{--accent:red}');
    expect(css).not.toContain(':root');
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

  it('rejects a structural transaction (structure lock)', () => {
    const r = toLiveHtml('<html><body><p>a</p><p>b</p></body></html>');
    if (!r.ok) throw new Error(r.reason);
    let view: any = null;
    mount(
      <HtmlLiveView doc={r.doc} styleText={r.styleText} editable onViewReady={(v) => { view = v; }} />,
    );
    const firstSize = view.state.doc.child(0).nodeSize;
    act(() => { view.dispatch(view.state.tr.delete(0, firstSize)); });
    expect(view.state.doc.childCount).toBe(2); // rejected → still two blocks
  });

  it('does not fire onEdit for a lock-rejected transaction, but does for an in-block edit', () => {
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

    // Structural edit: deletes the whole first block — rejected by the
    // structure lock. Must NOT report an edit (the doc is unchanged).
    const firstSize = view.state.doc.child(0).nodeSize;
    act(() => { view.dispatch(view.state.tr.delete(0, firstSize)); });
    expect(view.state.doc.childCount).toBe(2); // confirms rejection took effect
    expect(onEdit).not.toHaveBeenCalled();

    // Within-block text edit: allowed by the lock — must report an edit.
    act(() => { view.dispatch(view.state.tr.insertText('!', 2)); });
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
