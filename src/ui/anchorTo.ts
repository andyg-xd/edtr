/**
 * Positions a floating element (a tooltip, a popover) relative to a trigger
 * rectangle. Pure: takes rectangles and sizes, returns coordinates -- no DOM,
 * no `window`, no React. That's what makes it unit-testable without a
 * browser, and what lets Task 6's popover-positioning fix reuse it instead of
 * duplicating the clamping logic.
 */
export function anchorTo(
  trigger: DOMRect,
  floating: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 6,
): { left: number; top: number } {
  const margin = 4;

  const triggerCenter = trigger.left + trigger.width / 2;
  const rawLeft = triggerCenter - floating.width / 2;
  const left = Math.max(margin, Math.min(rawLeft, viewport.width - floating.width - margin));

  const below = trigger.bottom + gap;
  const fitsBelow = below + floating.height <= viewport.height - margin;
  const top = fitsBelow ? below : trigger.top - floating.height - gap;

  return { left, top };
}
