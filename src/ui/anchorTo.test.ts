import { describe, it, expect } from 'vitest';
import { anchorTo } from './anchorTo';

const VP = { width: 800, height: 600 };
const rect = (left: number, width = 24) =>
  ({ left, right: left + width, top: 40, bottom: 62, width, height: 22 }) as DOMRect;

describe('anchorTo', () => {
  it('centres the floating element under its trigger', () => {
    const { left, top } = anchorTo(rect(400), { width: 100, height: 30 }, VP);
    expect(left).toBe(400 + 12 - 50); // trigger centre minus half the width
    expect(top).toBe(62 + 6);          // below the trigger, default 6px gap
  });

  it('clamps at the left edge instead of overflowing', () => {
    // A control at the ribbon's start must not push its tooltip off-screen.
    expect(anchorTo(rect(2), { width: 120, height: 30 }, VP).left).toBe(4);
  });

  it('clamps at the right edge instead of overflowing', () => {
    expect(anchorTo(rect(790), { width: 120, height: 30 }, VP).left).toBe(800 - 120 - 4);
  });

  it('flips above the trigger when there is no room below', () => {
    const r = { ...rect(400), top: 560, bottom: 582 } as DOMRect;
    expect(anchorTo(r, { width: 100, height: 30 }, VP).top).toBe(560 - 30 - 6);
  });
});
