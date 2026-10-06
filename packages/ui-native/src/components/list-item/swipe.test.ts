import { describe, expect, it } from 'vitest';

import { swipeOutcome } from './swipe.ts';

const at = (offset: number, velocity = 0) =>
  swipeOutcome({ offset, velocity, tray: 152, width: 358, full: true });

describe('where a released row settles', () => {
  it('opens past half the tray and closes short of it', () => {
    expect(at(80)).toBe('open');
    expect(at(70)).toBe('closed');
  });

  it('runs the first action past 60% of the row, unless that is switched off', () => {
    expect(at(220)).toBe('full');
    expect(swipeOutcome({ offset: 220, velocity: 0, tray: 152, width: 358, full: false })).toBe(
      'open',
    );
  });

  it('follows a flick over the distance, and a flick back closes from anywhere', () => {
    expect(at(10, 900)).toBe('open');
    expect(at(300, -900)).toBe('closed');
  });
});
