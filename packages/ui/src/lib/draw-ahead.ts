import { defaultRangeExtractor, type Range } from '@tanstack/react-virtual';
import { useCallback, useReducer, useRef } from 'react';
import { flushSync } from 'react-dom';

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

/**
 * The rows a scroll lands on, drawn in the scroll event itself when they are
 * not among the rows already drawn.
 *
 * The virtualizer renders with the frame, not inside each scroll event, and
 * the lead above covers an ordinary scroll. A jump does not: a fling past the
 * lead, a drag of the scrollbar, Back to top. Those painted the rows' spacer
 * for a frame and filled in after, which a reader sees as loaded rows going
 * blank. Here a jump renders at once, so the frame it paints has the rows;
 * every scroll inside what is drawn stays with the frame, as before.
 *
 * `onChange` is the virtualizer's option; `drawn` is set, after each commit,
 * to the first and last row index on the page.
 */
export function useCatchUp(): {
  readonly onChange: (
    instance: { readonly range: { startIndex: number; endIndex: number } | null },
    sync: boolean,
  ) => void;
  readonly drawn: { current: readonly [number, number] };
} {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const drawn = useRef<readonly [number, number]>([0, -1]);
  const onChange = useCallback(
    (
      instance: { readonly range: { startIndex: number; endIndex: number } | null },
      sync: boolean,
    ): void => {
      const range = instance.range;
      // Only from a scroll event: a measure or a resize may arrive mid-render.
      if (!sync || range === null) return;
      const [first, last] = drawn.current;
      if (range.startIndex < first || range.endIndex > last) flushSync(redraw);
    },
    [],
  );
  return { onChange, drawn };
}
