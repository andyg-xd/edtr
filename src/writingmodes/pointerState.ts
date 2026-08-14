/**
 * Is a pointer button currently held down anywhere in this window?
 *
 * Exists for one reason: typewriter mode must not scroll during a mouse drag
 * (6c-ii-b, F1). `holdCaret` runs on every selection change, and a drag-select
 * changes the selection on every pointer move — so scrolling in response
 * moves the content out from under the held pointer, which extends the
 * drag-selection further, which fires another hold. It is a FEEDBACK LOOP, not
 * a timing race, which is why a delay does not fix it: a delayed scroll still
 * lands mid-drag and still feeds the loop, just later.
 *
 * Module-level rather than per-view on purpose. The drivers are rebuilt by a
 * `useMemo` whenever the view changes and `TypewriterSurface` has no dispose
 * step, so per-instance listeners would leak one set per rebuild. One
 * window-scoped listener pair, installed once, cannot.
 *
 * Listeners are on `window` in the CAPTURE phase so this still sees the event
 * if something downstream stops propagation, and because pointer events are
 * composed — they cross the shadow boundary out of HTML Live's shadow root,
 * so the same tracker serves all three surfaces without knowing about any of
 * them.
 */
let pointerDown = false;
let installed = false;

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  window.addEventListener('pointerup', () => { pointerDown = false; }, true);
  window.addEventListener('pointercancel', () => { pointerDown = false; }, true);
  // Releasing the button outside the window can mean no pointerup ever
  // arrives. Without this the flag latches on and typewriter mode stops
  // holding for the rest of the session — a worse failure than the one being
  // fixed, and an invisible one.
  window.addEventListener('blur', () => { pointerDown = false; });
}

export function isPointerDown(): boolean {
  install();
  return pointerDown;
}

/** Test-only: drop the latched state between cases. */
export function resetPointerStateForTests(): void {
  pointerDown = false;
}
