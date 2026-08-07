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
    let viewDestroyed = false;
    let destroyedWhenNullReported: boolean | null = null;
    const { root } = await mount(
      <CodeView
        initialText={'x\n'}
        format="markdown"
        effectiveTheme="light"
        onChange={() => {}}
        onViewReady={(v) => {
          seen.push(v);
          if (v) {
            // Spy on the real view's destroy() so that when null arrives
            // below, the test can tell whether destroy() had already run.
            // "null last" alone can't prove that: it would be true even if
            // destroy() ran FIRST, since destroy() never itself calls
            // onViewReady.
            const real = v.destroy.bind(v);
            v.destroy = () => { viewDestroyed = true; real(); };
          } else {
            destroyedWhenNullReported = viewDestroyed;
          }
        }}
      />,
    );
    expect(seen.length).toBe(1);
    expect(seen[0]).toBeTruthy();
    await act(async () => root.unmount());
    expect(seen[seen.length - 1]).toBeNull();
    // The real claim: a consumer told "no view" must never have been handed a
    // destroyed one moments earlier — destroy() had not yet run when null was
    // reported.
    expect(destroyedWhenNullReported).toBe(false);
  });
});
