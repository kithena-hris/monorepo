import { describe, expect, it } from 'vitest';

import { bandFor } from './local-time';

/**
 * The bands are a chain of comparisons, which is exactly the shape that goes
 * wrong by one at a boundary — and the wrong glyph at 17:00 is the bug this
 * component was changed to fix in the first place.
 */
describe('bandFor', () => {
  it.each([
    [0, 'lateNight'],
    [4, 'lateNight'],
    [5, 'dawn'],
    [7, 'dawn'],
    [8, 'daytime'],
    [16, 'daytime'],
    [17, 'dusk'],
    [19, 'dusk'],
    [20, 'night'],
    [23, 'night'],
  ])('%i is %s', (hour, band) => {
    expect(bandFor(hour)).toBe(band);
  });

  it('falls back to night rather than throwing on a value no clock produced', () => {
    expect(bandFor(Number.NaN)).toBe('night');
  });
});
