// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { FolderSidebar } from './FolderSidebar';
import type { FolderEntry } from '../files/folder';

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

function render(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return container!;
}

const entries: FolderEntry[] = [
  { name: 'a.md', path: '/f/a.md' },
  { name: 'b.html', path: '/f/b.html' },
];

describe('FolderSidebar', () => {
  it('renders one row per entry, marks the active one, dims unopened', () => {
    const c = render(
      <FolderSidebar
        entries={entries}
        activePath="/f/a.md"
        openPaths={new Set(['/f/a.md'])}
        dirtyForPath={() => false}
        onOpen={() => {}}
      />,
    );
    const names = Array.from(c.querySelectorAll('.sidebar-name')).map((n) => n.textContent);
    expect(names).toEqual(['a.md', 'b.html']);
    const active = c.querySelector('[aria-current="true"] .sidebar-name');
    expect(active?.textContent).toBe('a.md');
    const items = Array.from(c.querySelectorAll('.sidebar-item'));
    expect(items[0].classList.contains('is-unopened')).toBe(false); // open
    expect(items[1].classList.contains('is-unopened')).toBe(true);  // not open
  });

  it('shows a dirty dot only for open+dirty entries, and never a close button', () => {
    const c = render(
      <FolderSidebar
        entries={entries}
        activePath="/f/a.md"
        openPaths={new Set(['/f/a.md'])}
        dirtyForPath={(p) => p === '/f/a.md'}
        onOpen={() => {}}
      />,
    );
    const items = Array.from(c.querySelectorAll('.sidebar-item'));
    expect(items[0].querySelector('.sidebar-dot')).not.toBeNull(); // open + dirty
    expect(items[1].querySelector('.sidebar-dot')).toBeNull();     // not open
    expect(c.querySelector('.sidebar-close')).toBeNull();          // no × in folder mode
  });

  it('fires onOpen(path) on row click', () => {
    const onOpen = vi.fn();
    const c = render(
      <FolderSidebar
        entries={entries}
        activePath={null}
        openPaths={new Set()}
        dirtyForPath={() => false}
        onOpen={onOpen}
      />,
    );
    (c.querySelectorAll('.sidebar-select')[1] as HTMLButtonElement).click();
    expect(onOpen).toHaveBeenCalledWith('/f/b.html');
  });

  it('shows an empty notice and no list when there are no entries', () => {
    const c = render(
      <FolderSidebar entries={[]} activePath={null} openPaths={new Set()} dirtyForPath={() => false} onOpen={() => {}} />,
    );
    expect(c.querySelector('.sidebar-empty')).not.toBeNull();
    expect(c.querySelector('.sidebar-list')).toBeNull();
  });
});
