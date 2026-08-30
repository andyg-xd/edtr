import { useEffect, useRef, type ReactNode } from 'react';

/** Focusable descendants, in tab order, skipping anything currently disabled. */
function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
}

interface ModalDialogProps {
  /** The dialog's accessible name. */
  label: string;
  children: ReactNode;
}

/**
 * The backdrop, the modal box, and the focus trap the guard dialogs share.
 *
 * Both `CloseGuard` and `ReplaceAllGuard` were plain fixed divs: no `inert`,
 * no initial focus, and neither editor sets `tabIndex={-1}`, so the document
 * behind them stayed keyboard-reachable and Tab walked straight out of the
 * dialog into the text the dialog was asking about.
 *
 * One primitive rather than the same fix twice, because the two dialogs
 * diverging is the actual risk -- they are the only two modals in the app and
 * they should not answer a keyboard differently.
 *
 * `inert` on the rest of the document would be the tidier mechanism, but it
 * needs a single wrapper around everything else to apply to, and the window's
 * chrome has no such element. Trapping at the dialog is the change that does
 * not require restructuring the window to make a dialog behave.
 */
export function ModalDialog({ label, children }: ModalDialogProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Remember what had focus so it can be handed back. A dialog that steals
    // focus and never returns it leaves the caret nowhere in particular.
    const restoreTo = document.activeElement as HTMLElement | null;
    focusable(node)[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusable(node);
      if (items.length === 0) return;

      // The trap moves focus itself for EVERY Tab, rather than only wrapping at
      // the ends and letting the browser handle the middle. Two reasons, and
      // the second is the load-bearing one:
      //
      //   1. Focus can be outside the dialog entirely -- a click on the
      //      backdrop, or focus never having entered -- and a wrap-only trap
      //      resumes walking the document behind from there.
      //   2. jsdom does not implement sequential focus navigation at all. A
      //      wrap-only trap is therefore UNTESTABLE in the middle of the tab
      //      order: the test environment moves nothing, so the assertion would
      //      have to be weakened to match the harness rather than the user.
      //      Owning the movement makes the behaviour identical in jsdom and in
      //      WKWebView, which is the divergence this project has been bitten by
      //      before (jsdom's `navigator.vendor` sends ProseMirror down a
      //      different branch than production takes).
      e.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      const at = active ? items.indexOf(active) : -1;
      const step = e.shiftKey ? -1 : 1;
      // From outside the dialog, Tab enters at the start and Shift+Tab at the
      // end -- the same places the browser would have entered from.
      const next = at === -1
        ? (e.shiftKey ? items.length - 1 : 0)
        : (at + step + items.length) % items.length;
      items[next].focus();
    };

    // Capture, so the trap sees Tab before anything inside the dialog can stop
    // it, and on `document` so it still fires if focus has escaped the node.
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      restoreTo?.focus?.();
    };
  }, []);

  return (
    <div
      ref={ref}
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div className="modal">{children}</div>
    </div>
  );
}
