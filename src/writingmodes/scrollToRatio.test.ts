import { describe, it, expect } from 'vitest';
import { scrollDelta } from './scrollToRatio';

describe('scrollDelta', () => {
  it('scrolls down when the target sits below the rest position', () => {
    // Scroller occupies client-Y 100..500. At ratio 0.42 the rest position is
    // 100 + 400*0.42 = 268. A target centred at 300 must move down by 32.
    expect(scrollDelta({ top: 100, height: 400 }, 300, 0.42)).toBe(32);
  });

  it('scrolls up when the target sits above the rest position', () => {
    expect(scrollDelta({ top: 100, height: 400 }, 200, 0.42)).toBe(-68);
  });

  it('does not move when the target is already at the rest position', () => {
    expect(scrollDelta({ top: 100, height: 400 }, 268, 0.42)).toBe(0);
  });

  it('puts the target at the vertical middle for ratio 0.5', () => {
    // Guards the meaning of `ratio`: it is measured from the TOP of the
    // scroller, so 0.5 is the middle. If the sign or origin were wrong this
    // would not come out at 0.
    expect(scrollDelta({ top: 0, height: 400 }, 200, 0.5)).toBe(0);
  });

  it('honours the scroller offset rather than assuming it starts at zero', () => {
    expect(scrollDelta({ top: 50, height: 100 }, 100, 0)).toBe(50);
  });
});
