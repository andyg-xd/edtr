/**
 * How far the scroller must move for `targetCentreY` to rest at `ratio` of its
 * visible height. Positive scrolls down.
 *
 * Pure, and separated from the DOM write below on purpose: jsdom has no layout
 * and no scrolling box, so an assertion on `scrollTop` would be vacuous. This
 * is the part that can actually be tested.
 */
export function scrollDelta(
  rect: { top: number; height: number },
  targetCentreY: number,
  ratio: number,
): number {
  return targetCentreY - (rect.top + rect.height * ratio);
}

/**
 * Scroll `scroller` so `targetCentreY` comes to rest at `ratio` of its height.
 *
 * Explicit arithmetic because neither editor's own centring API can express an
 * arbitrary ratio (spec §3.2): ProseMirror goes through
 * `scrollIntoView({ block: 'center' })` and CodeMirror through
 * `EditorView.scrollIntoView(pos, { y: 'center' })`, and both accept only
 * start/center/end/nearest. This is why typewriter mode cannot reuse find's
 * reveal, and why `src/find/` is untouched.
 *
 * NOT unit-testable — see `scrollDelta`. Verified by GUI matrix item 1.
 */
export function scrollToRatio(opts: {
  scroller: HTMLElement;
  targetCentreY: number;
  ratio: number;
}): void {
  const { scroller, targetCentreY, ratio } = opts;
  const delta = scrollDelta(scroller.getBoundingClientRect(), targetCentreY, ratio);
  if (delta !== 0) scroller.scrollTop += delta;
}
