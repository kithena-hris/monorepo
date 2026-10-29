import { defaultRangeExtractor, type Range } from '@tanstack/react-virtual';

/** How far past the screen, in px, a list being scrolled draws in the direction it is going. */
export const AHEAD_PX = 3200;

/**
 * A virtualizer's `rangeExtractor` that draws further ahead while the list
 * moves: `ahead` more rows past the overscan on the side the scroll is
 * heading, and none extra behind it or at rest. A fling outran a symmetric
 * overscan, and the reader saw the rows' hairlines (`SpacerRow`) before the
 * rows themselves. Each frame still renders only the rows that come into
 * range, so the lead costs nothing per frame; it is a longer runway.
 *
 * `direction` is read when the range is, from the virtualizer itself
 * (`scrollDirection`), so the extractor is made once and stays the same
 * function: a new one each render reads to the virtualizer as new options.
 */
export function drawAhead(
  direction: () => 'forward' | 'backward' | null,
  ahead: number,
): (range: Range) => number[] {
  return (range) => {
    const going = direction();
    return defaultRangeExtractor({
      ...range,
      startIndex: going === 'backward' ? Math.max(0, range.startIndex - ahead) : range.startIndex,
      endIndex:
        going === 'forward' ? Math.min(range.count - 1, range.endIndex + ahead) : range.endIndex,
    });
  };
}
