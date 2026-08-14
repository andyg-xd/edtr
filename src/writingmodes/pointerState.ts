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
const releaseListeners = new Set<() => void>();

function release(): void {
  pointerDown = false;
  // Copied before iterating: a listener that unsubscribes itself would
  // otherwise mutate the set mid-iteration.
  for (const cb of [...releaseListeners]) cb();
}

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  // Releasing the button outside the window can mean no pointerup ever
  // arrives. Without this the flag latches on and typewriter mode stops
  // holding for the rest of the session — a worse failure than the one being
  // fixed, and an invisible one.
  window.addEventListener('blur', release);
}

export function isPointerDown(): boolean {
  install();
  return pointerDown;
}

/**
 * Run `cb` whenever a pointer is released. Returns an unsubscribe function.
 *
 * Typewriter mode needs this and does not work without it. A click's selection
 * change happens on POINTERDOWN, which the drag guard suppresses — and
 * pointerup carries no selection change of its own, so nothing would ever
 * re-run the hold and a plain click would never centre the caret at all. The
 * next thing to call `holdCaret` would be the first keystroke, by which point
 * the caret is far from the hold line and the viewport lurches the whole
 * distance in one jump. That is a real regression the first version of the
 * drag guard shipped, found in GUI validation.
 *
 * So: suppress during the drag, then re-arm once, on release, from the final
 * caret position. A release that ends on a RANGE selection still holds
 * nothing — the collapsed-selection guard in the drivers covers that — so
 * finishing a drag-select does not scroll either.
 */
export function subscribePointerRelease(cb: () => void): () => void {
  install();
  releaseListeners.add(cb);
  return () => { releaseListeners.delete(cb); };
}

/** Test-only: drop the latched state between cases. */
export function resetPointerStateForTests(): void {
  pointerDown = false;
  releaseListeners.clear();
}
