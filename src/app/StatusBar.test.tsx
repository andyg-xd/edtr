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
  it('shows a hovered link that will open as an invitation', async () => {
    const c = await render(<StatusBar format="markdown" line={1} column={1}
      linkHint={{ url: 'https://example.com/docs', action: '⌘-click to open', openable: true }} />);
    const link = c.querySelector('.status-bar-link')!;
    expect(c.querySelector('.status-bar-link-url')?.textContent).toBe('https://example.com/docs');
    expect(link.textContent).toBe('https://example.com/docs · ⌘-click to open');
    expect(link.classList.contains('is-openable')).toBe(true);
  });

  it('shows why a hovered link will not open, without the invitation styling', async () => {
    const c = await render(<StatusBar format="markdown" line={1} column={1}
      linkHint={{ url: '#top', action: "Edtr can't jump to sections yet", openable: false }} />);
    const link = c.querySelector('.status-bar-link')!;
    expect(link.textContent).toBe("#top · Edtr can't jump to sections yet");
    expect(link.classList.contains('is-openable')).toBe(false);
  });

  it('shows no link slot when nothing is hovered', async () => {
    const c = await render(<StatusBar format="markdown" line={1} column={1} />);
    expect(c.querySelector('.status-bar-link')).toBeNull();
  });

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

  it('always renders the counts slot, empty when no counts are given', async () => {
    const c = await render(<StatusBar format="markdown" line={1} column={1} />);
    const counts = c.querySelector('.status-bar-counts');
    expect(counts).toBeTruthy();
    expect(counts?.textContent).toBe('');
  });

  it('shows thousands-separated words and characters when both are given', async () => {
    const c = await render(<StatusBar format="markdown" words={1204} characters={6812} />);
    expect(c.querySelector('.status-bar-counts')?.textContent).toBe('1,204 words · 6,812 characters');
  });

  it('shows no count when only one figure is given', async () => {
    const c = await render(<StatusBar format="markdown" words={5} />);
    expect(c.querySelector('.status-bar-counts')!.textContent).toBe('');
  });

  it('labels the counts when they describe a SELECTION (6c-ii-b, F6)', async () => {
    // Without the label the same pair of numbers means two different things
    // and the bar swaps between them silently — the reader sees the figure
    // drop with no way to tell a selection from a shorter document.
    const c = await render(
      <StatusBar format="markdown" words={12} characters={68} isSelection />,
    );
    expect(c.querySelector('.status-bar-counts')?.textContent)
      .toBe('Selected: 12 words · 68 characters');
  });

  it('leaves the document count unlabelled and byte-identical to before', async () => {
    // Regression guard: 6c-ii's format must not drift while adding the
    // selection case. Same middle dot, same wording, no prefix.
    const c = await render(
      <StatusBar format="markdown" words={1204} characters={6812} isSelection={false} />,
    );
    expect(c.querySelector('.status-bar-counts')?.textContent)
      .toBe('1,204 words · 6,812 characters');
  });

  it('treats an omitted isSelection as the document count', async () => {
    const c = await render(<StatusBar format="markdown" words={3} characters={9} />);
    expect(c.querySelector('.status-bar-counts')?.textContent).toBe('3 words · 9 characters');
  });

  it('uses ONE separator for both cases', async () => {
    // The selection format was specified with a bullet and the document count
    // has always used a middle dot; the owner chose the middle dot for both
    // (2026-08-14) so the bar does not change punctuation with its state.
    const sel = await render(<StatusBar format="markdown" words={1} characters={2} isSelection />);
    const selText = sel.querySelector('.status-bar-counts')!.textContent!;
    container!.remove(); container = null;
    const doc = await render(<StatusBar format="markdown" words={1} characters={2} />);
    const docText = doc.querySelector('.status-bar-counts')!.textContent!;
    expect(selText).toContain(' · ');
    expect(docText).toContain(' · ');
    expect(selText.includes('•'), 'the bar must not switch punctuation with its state').toBe(false);
  });
});
