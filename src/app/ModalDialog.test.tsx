// @vitest-environment jsdom
//
// The focus trap both guard dialogs share.
//
// Neither dialog trapped focus: `.modal-backdrop` is a plain fixed div with no
// `inert`, neither set initial focus, and neither editor sets `tabIndex={-1}`,
// so the document behind stayed keyboard-reachable. The data-loss path that
// made worst is already closed at the correctness level -- a pending replace
// set is stamped with its surface and document version and refused wholesale
// on mismatch -- which is why this is polish rather than safety.
//
// It lives in ONE primitive because the debt entry asked for exactly that:
// "as one task covering both dialogs, so they do not end up behaving
// differently." Two copies of a focus trap is two chances to fix one of them.
//
// Tab is dispatched directly rather than driven through a library: jsdom does
// not implement sequential focus navigation, so a real Tab keypress moves
// nothing on its own and the handler under test is what must do the moving.
// That is also why each assertion checks `document.activeElement` -- the thing
// a user would see -- rather than that a handler was called.
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';
import { ModalDialog } from './ModalDialog';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

async function render(node: ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
  return container!;
}

/** A real Tab keypress, dispatched at whatever currently has focus. */
function tab(shift = false) {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }),
  );
}

const btn = (name: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent === name)!;

describe('ModalDialog', () => {
  it('moves focus into the dialog on mount', async () => {
    await render(
      <ModalDialog label="Test">
        <button>First</button>
        <button>Second</button>
      </ModalDialog>,
    );
    expect(document.activeElement).toBe(btn('First'));
  });

  it('keeps Tab inside the dialog, wrapping at the end', async () => {
    await render(
      <ModalDialog label="Test">
        <button>First</button>
        <button>Second</button>
      </ModalDialog>,
    );

    tab();
    expect(document.activeElement).toBe(btn('Second'));
    // Wraps rather than escaping to whatever is behind.
    tab();
    expect(document.activeElement).toBe(btn('First'));
  });

  it('keeps Shift+Tab inside the dialog, wrapping at the start', async () => {
    await render(
      <ModalDialog label="Test">
        <button>First</button>
        <button>Second</button>
      </ModalDialog>,
    );

    tab(true);
    expect(document.activeElement).toBe(btn('Second'));
  });

  it('cannot be escaped by tabbing into content behind it', async () => {
    // A focusable element OUTSIDE the dialog, standing in for the editor.
    const outside = document.createElement('button');
    outside.textContent = 'Behind';
    document.body.appendChild(outside);

    await render(
      <ModalDialog label="Test">
        <button>Only</button>
      </ModalDialog>,
    );

    tab();
    tab();
    expect(document.activeElement).not.toBe(outside);
    expect(document.activeElement).toBe(btn('Only'));

    outside.remove();
  });

  it('restores focus to whatever had it before, on unmount', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Opener';
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    await render(
      <ModalDialog label="Test">
        <button>Inside</button>
      </ModalDialog>,
    );
    expect(document.activeElement).not.toBe(opener);

    await act(async () => root!.unmount());
    root = null;
    expect(document.activeElement).toBe(opener);

    opener.remove();
  });

  it('carries the dialog role, the modal flag and the label it is given', async () => {
    await render(
      <ModalDialog label="Unsaved changes">
        <button>OK</button>
      </ModalDialog>,
    );
    const dialog = container!.querySelector('.modal-backdrop')!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Unsaved changes');
  });

  it('does not swallow keys other than Tab', async () => {
    await render(
      <ModalDialog label="Test">
        <button>First</button>
        <button>Second</button>
      </ModalDialog>,
    );
    const ev = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(btn('First'));
  });
});
