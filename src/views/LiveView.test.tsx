// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { buildLiveDoc } from './liveModel';
import { LiveView } from './LiveView';

let container: HTMLDivElement | null = null;
afterEach(() => {
  container?.remove();
  container = null;
});

function render(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return container;
}

describe('LiveView', () => {
  it('renders the projected markdown read-only', () => {
    const r = buildLiveDoc('# Hello\n\nWorld\n');
    if (!r.ok) throw new Error('degraded');
    const el = render(<LiveView doc={r.doc} />);
    expect(el.querySelector('h1')?.textContent).toBe('Hello');
    expect(el.querySelector('p')?.textContent).toBe('World');
    // read-only: the ProseMirror content is not editable
    expect(el.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false');
  });
});
