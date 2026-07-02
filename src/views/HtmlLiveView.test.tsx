// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
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
    // the paragraph rendered with its class, inside the shadow root
    expect(shadow.querySelector('p.lead')?.textContent).toBe('hi');
  });
});
