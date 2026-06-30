// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { EditorState } from 'prosemirror-state';
import { buildLiveDoc } from './liveModel';
import { liveSchema } from './liveSchema';
import { LiveView, structureLockPlugin } from './LiveView';

let container: HTMLDivElement | null = null;
afterEach(() => {
  container?.remove();
  container = null;
});

async function render(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return container;
}

function docFor(src: string) {
  const r = buildLiveDoc(src);
  if (!r.ok) throw new Error('degraded');
  return r.doc;
}

describe('LiveView', () => {
  it('renders the projected markdown', async () => {
    const el = await render(<LiveView doc={docFor('# Hello\n\nWorld\n')} />);
    expect(el.querySelector('h1')?.textContent).toBe('Hello');
    expect(el.querySelector('p')?.textContent).toBe('World');
  });

  it('is editable by default in 3b', async () => {
    const el = await render(<LiveView doc={docFor('# Hello\n')} />);
    expect(el.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('true');
  });

  it('can be mounted read-only', async () => {
    const el = await render(<LiveView doc={docFor('# Hello\n')} editable={false} />);
    expect(el.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false');
  });
});

describe('structureLockPlugin', () => {
  it('rejects a transaction that changes the top-level block count', () => {
    const doc = docFor('alpha\n\nbeta\n'); // two top-level paragraphs
    expect(doc.childCount).toBe(2); // sanity
    const state = EditorState.create({ doc, schema: liveSchema, plugins: [structureLockPlugin()] });
    // delete across the boundary between the two paragraphs (would merge → 1 block)
    const tr = state.tr.delete(doc.child(0).nodeSize - 1, doc.child(0).nodeSize + 1);
    const after = state.apply(tr);
    expect(after.doc.childCount).toBe(2); // lock fired → structure unchanged
  });

  it('allows an intra-block text insertion', () => {
    const doc = docFor('alpha\n');
    const state = EditorState.create({ doc, schema: liveSchema, plugins: [structureLockPlugin()] });
    const after = state.apply(state.tr.insertText('X', 1));
    expect(after.doc.childCount).toBe(1);          // structure unchanged
    expect(after.doc.textContent).toBe('Xalpha');  // but the text WAS applied
  });
});
