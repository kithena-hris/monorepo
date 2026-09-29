import { describe, expect, it } from 'vitest';

import { nearestSlide, scrollEdges } from './carousel';

describe('nearestSlide', () => {
  const offsets = [0, 232, 464, 696];

  it('picks the slide whose start is closest to the scroll position', () => {
    expect(nearestSlide(offsets, 0)).toBe(0);
    expect(nearestSlide(offsets, 115)).toBe(0);
    expect(nearestSlide(offsets, 117)).toBe(1);
    expect(nearestSlide(offsets, 690)).toBe(3);
    // Past the last start, as when the track ends before the last slide can snap.
    expect(nearestSlide(offsets, 5000)).toBe(3);
  });

  it('is 0 for a carousel with no slides', () => {
    expect(nearestSlide([], 40)).toBe(0);
  });
});

describe('scrollEdges', () => {
  it('knows the start and the end, with a pixel of slack for fractional scrolling', () => {
    expect(scrollEdges(0, 1000, 400)).toEqual({ atStart: true, atEnd: false });
    expect(scrollEdges(300, 1000, 400)).toEqual({ atStart: false, atEnd: false });
    expect(scrollEdges(599.5, 1000, 400)).toEqual({ atStart: false, atEnd: true });
    // Everything fits: nowhere to go either way.
    expect(scrollEdges(0, 400, 400)).toEqual({ atStart: true, atEnd: true });
  });
});
