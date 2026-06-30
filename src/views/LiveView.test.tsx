// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { buildLiveDoc } from './liveModel';
import { LiveView } from './LiveView';

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

import { EditorState } from 'prosemirror-state';
import { liveSchema } from './liveSchema';
import { structureLockPlugin } from './LiveView';

describe('structureLockPlugin', () => {
  it('rejects a transaction that changes the top-level block count', () => {
    const doc = docFor('alpha\n\nbeta\n');
    const state = EditorState.create({ doc, schema: liveSchema, plugins: [structureLockPlugin()] });
    // try to delete the boundary between the two paragraphs (would merge → fewer blocks)
    const tr = state.tr.delete(state.doc.child(0).nodeSize - 1, state.doc.child(0).nodeSize + 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((state as any).filterTransaction(tr, state)).toBe(false);
  });

  it('allows an intra-block text insertion', () => {
    const doc = docFor('alpha\n');
    const state = EditorState.create({ doc, schema: liveSchema, plugins: [structureLockPlugin()] });
    const tr = state.tr.insertText('X', 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((state as any).filterTransaction(tr, state)).toBe(true);
  });
});
