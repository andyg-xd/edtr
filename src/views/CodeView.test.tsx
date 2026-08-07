// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { CodeView } from './CodeView';

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

async function mount(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return { container: container!, root };
}

describe('CodeView theme reconfigure', () => {
  it('swaps theme in place without remounting the editor', async () => {
    const { container: c, root } = await mount(
      <CodeView initialText={'x\n'} format="markdown" effectiveTheme="light" onChange={() => {}} />,
    );
    const before = c.querySelector('.cm-editor');
    expect(before).toBeTruthy();

    await act(async () =>
      root.render(
        <CodeView initialText={'x\n'} format="markdown" effectiveTheme="dark" onChange={() => {}} />,
      ),
    );
    const after = c.querySelector('.cm-editor');
    // Same DOM node => the EditorView was reconfigured, not recreated.
    expect(after).toBe(before);
  });
});

describe('CodeView onViewReady', () => {
  it('reports its EditorView on mount and null on unmount', async () => {
    const seen: Array<unknown> = [];
    const { root } = await mount(
      <CodeView
        initialText={'x\n'}
        format="markdown"
        effectiveTheme="light"
        onChange={() => {}}
        onViewReady={(v) => seen.push(v)}
      />,
    );
    expect(seen.length).toBe(1);
    expect(seen[0]).toBeTruthy();
    await act(async () => root.unmount());
    // Null LAST, before destroy — a consumer must never hold a destroyed view.
    expect(seen[seen.length - 1]).toBeNull();
  });
});
