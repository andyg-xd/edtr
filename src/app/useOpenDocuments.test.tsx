// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { DocumentSession } from '../files/documentSession';
import { useOpenDocuments } from './useOpenDocuments';

const sess = (path: string) =>
  new DocumentSession({ path, format: 'markdown', meta: { eol: 'lf', hadBom: false }, text: 'x' });

function Probe() {
  const docs = useOpenDocuments();
  return (
    <div>
      <span data-testid="count">{docs.state.docs.length}</span>
      <span data-testid="path">{docs.active?.session.path ?? 'none'}</span>
      <span data-testid="viewMode">{docs.active?.viewMode ?? 'none'}</span>
      <button data-testid="open-a" onClick={() => docs.openReplace(sess('/a.md'))}>a</button>
      <button data-testid="open-b" onClick={() => docs.openReplace(sess('/b.md'))}>b</button>
      <button data-testid="to-live" onClick={() => docs.active && docs.setViewMode(docs.active.id, 'live')}>live</button>
    </div>
  );
}

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

async function render(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return container!;
}
const txt = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`)!.textContent;
const click = async (c: HTMLElement, id: string) =>
  act(async () => c.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click());

describe('useOpenDocuments', () => {
  it('openReplace makes exactly one active doc and replaces on a second open (5a single-doc behavior)', async () => {
    const c = await render(<Probe />);
    await click(c, 'open-a');
    expect(txt(c, 'count')).toBe('1');
    expect(txt(c, 'path')).toBe('/a.md');
    await click(c, 'open-b');
    expect(txt(c, 'count')).toBe('1'); // replaced, not appended
    expect(txt(c, 'path')).toBe('/b.md');
  });

  it('setViewMode updates the active doc', async () => {
    const c = await render(<Probe />);
    await click(c, 'open-a');
    await click(c, 'to-live');
    expect(txt(c, 'viewMode')).toBe('live');
  });
});
