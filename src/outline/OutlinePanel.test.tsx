// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { OutlinePanel } from './OutlinePanel';
import type { OutlineEntry } from './types';

// This project uses NO testing-library. Component tests render with
// `createRoot` + `act` and query the DOM directly — see `Sidebar.test.tsx`,
// which is the pattern this file follows.

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

function render(node: ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => createRoot(container!).render(node));
  return container;
}

function buttonNamed(root: HTMLElement, text: string): HTMLButtonElement {
  const hit = [...root.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!hit) throw new Error(`no button labelled ${text}`);
  return hit as HTMLButtonElement;
}

const entry = (level: number, text: string, srcFrom: number): OutlineEntry => ({
  id: text, level, text, srcFrom, srcTo: srcFrom + 5,
  ordinalInBlock: 0, blockFrom: srcFrom, blockTo: srcFrom + 5,
});

describe('OutlinePanel', () => {
  const entries = [entry(1, 'Title', 0), entry(2, 'Section', 20)];

  it('lists every heading', () => {
    const root = render(<OutlinePanel entries={entries} activeIndex={null} onSelect={() => {}} />);
    expect(buttonNamed(root, 'Title')).toBeTruthy();
    expect(buttonNamed(root, 'Section')).toBeTruthy();
  });

  it('marks the active entry for assistive tech, not only visually', () => {
    const root = render(<OutlinePanel entries={entries} activeIndex={1} onSelect={() => {}} />);
    expect(buttonNamed(root, 'Section').getAttribute('aria-current')).toBe('true');
    expect(buttonNamed(root, 'Title').getAttribute('aria-current')).toBeNull();
  });

  it('hands the whole entry back on click, so the caller need not look it up', () => {
    const onSelect = vi.fn();
    const root = render(<OutlinePanel entries={entries} activeIndex={null} onSelect={onSelect} />);
    act(() => { buttonNamed(root, 'Section').click(); });
    expect(onSelect).toHaveBeenCalledWith(entries[1]);
  });

  it('says so plainly when the document has no headings', () => {
    const root = render(<OutlinePanel entries={[]} activeIndex={null} onSelect={() => {}} />);
    expect(root.textContent).toContain('No headings in this document');
  });

  it('indents by nesting depth rather than by raw heading level', () => {
    // An h3 directly under an h1 sits at depth 1, not depth 2 — the document
    // skipped a level, and the panel must not show a phantom gap.
    const root = render(
      <OutlinePanel entries={[entry(1, 'A', 0), entry(3, 'C', 10)]} activeIndex={null} onSelect={() => {}} />,
    );
    expect(buttonNamed(root, 'C').style.getPropertyValue('--outline-depth')).toBe('1');
  });
});
