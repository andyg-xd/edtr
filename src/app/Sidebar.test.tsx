// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { Sidebar } from './Sidebar';
import { DocumentSession } from '../files/documentSession';
import type { OpenDoc } from '../files/openDocuments';

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

function render(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return container!;
}

const doc = (id: string, path: string): OpenDoc => ({
  id,
  session: new DocumentSession({ path, text: 'x', meta: { eol: 'lf', hadBom: false }, format: 'markdown' }),
  viewMode: 'code',
});

describe('Sidebar', () => {
  const docs = [doc('d0', '/a.md'), doc('d1', '/b.html')];

  it('renders one row per doc with its basename, marks the active row', () => {
    const c = render(<Sidebar docs={docs} activeId="d1" dirtyFor={() => false} onSelect={() => {}} onClose={() => {}} />);
    const names = Array.from(c.querySelectorAll('.sidebar-name')).map((n) => n.textContent);
    expect(names).toEqual(['a.md', 'b.html']);
    const active = c.querySelector('[aria-current="true"] .sidebar-name');
    expect(active?.textContent).toBe('b.html');
  });

  it('shows a dirty dot only for docs dirtyFor() flags', () => {
    const c = render(<Sidebar docs={docs} activeId="d0" dirtyFor={(d) => d.id === 'd1'} onSelect={() => {}} onClose={() => {}} />);
    const items = Array.from(c.querySelectorAll('.sidebar-item'));
    expect(items[0].querySelector('.sidebar-dot')).toBeNull();
    expect(items[1].querySelector('.sidebar-dot')).not.toBeNull();
  });

  it('fires onSelect on row click and onClose (not onSelect) on the × button', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const c = render(<Sidebar docs={docs} activeId="d0" dirtyFor={() => false} onSelect={onSelect} onClose={onClose} />);
    (c.querySelectorAll('.sidebar-select')[1] as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalledWith('d1');
    onSelect.mockClear();
    (c.querySelectorAll('.sidebar-close')[0] as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledWith('d0');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
