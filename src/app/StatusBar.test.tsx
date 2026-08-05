// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { StatusBar } from './StatusBar';

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

async function render(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return container!;
}

describe('StatusBar', () => {
  it('renders the format label', async () => {
    const c = await render(<StatusBar format="markdown" />);
    expect(c.querySelector('.status-bar-format')?.textContent).toBe('Markdown');
  });

  it('renders HTML and Text labels', async () => {
    const html = await render(<StatusBar format="html" />);
    expect(html.querySelector('.status-bar-format')?.textContent).toBe('HTML');
    const text = await render(<StatusBar format="plaintext" />);
    expect(text.querySelector('.status-bar-format')?.textContent).toBe('Text');
  });

  it('renders Ln n, Col n when given a position', async () => {
    const c = await render(<StatusBar format="markdown" line={12} column={4} />);
    expect(c.querySelector('.status-bar-position')?.textContent).toBe('Ln 12, Col 4');
  });

  it('omits the position when line/column are not given', async () => {
    const c = await render(<StatusBar format="html" />);
    expect(c.querySelector('.status-bar-position')).toBeNull();
  });

  it('never renders a position from a partial line/column pair', async () => {
    const onlyLine = await render(<StatusBar format="markdown" line={5} />);
    expect(onlyLine.querySelector('.status-bar-position')).toBeNull();
    const onlyColumn = await render(<StatusBar format="markdown" column={5} />);
    expect(onlyColumn.querySelector('.status-bar-position')).toBeNull();
  });

  it('always renders the counts slot, empty', async () => {
    const c = await render(<StatusBar format="markdown" line={1} column={1} />);
    const counts = c.querySelector('.status-bar-counts');
    expect(counts).toBeTruthy();
    expect(counts?.textContent).toBe('');
  });
});
