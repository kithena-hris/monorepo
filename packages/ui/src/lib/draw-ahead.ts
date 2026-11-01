import { defaultRangeExtractor, type Range } from '@tanstack/react-virtual';

/** How far past the screen, in px, a list being scrolled draws in the direction it is going. */
export const AHEAD_PX = 3200;

/**
 * Up to this many rows a list draws every row it has loaded, scrolled or not.
 * A row already loaded must never be shown empty: a fling, a drag of the
 * scrollbar or Back to top outran any lead, and the reader saw blank rows
 * fill in a frame later. Past it, the lead below takes over.
 */
export const DRAW_ALL = 1000;

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
  all = DRAW_ALL,
): (range: Range) => number[] {
  return (range) => {
    if (range.count <= all) return Array.from({ length: range.count }, (_, i) => i);
    const going = direction();
    return defaultRangeExtractor({
      ...range,
      startIndex: going === 'backward' ? Math.max(0, range.startIndex - ahead) : range.startIndex,
      endIndex:
        going === 'forward' ? Math.min(range.count - 1, range.endIndex + ahead) : range.endIndex,
    });
  };
}
