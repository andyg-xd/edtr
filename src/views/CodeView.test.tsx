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
