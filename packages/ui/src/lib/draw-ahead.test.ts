import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { drawAhead, useCatchUp } from './draw-ahead';

const range = { startIndex: 100, endIndex: 110, overscan: 5, count: 1000 };

describe('drawAhead', () => {
  it('draws further on the side the scroll is going, and only there', () => {
    expect(drawAhead(() => 'forward', 50)(range)).toEqual(
      Array.from({ length: 71 }, (_, i) => 95 + i),
    );
    expect(drawAhead(() => 'backward', 50)(range)).toEqual(
      Array.from({ length: 71 }, (_, i) => 45 + i),
    );
  });

  it('draws the overscan alone at rest, and never past either end', () => {
    expect(drawAhead(() => null, 50)(range)).toEqual(Array.from({ length: 21 }, (_, i) => 95 + i));
    expect(drawAhead(() => 'forward', 50)({ ...range, endIndex: 990 })).toHaveLength(1000 - 95);
    expect(drawAhead(() => 'backward', 50)({ ...range, startIndex: 10 }).at(0)).toBe(0);
  });
});

describe('useCatchUp', () => {
  it('draws at once only when a scroll lands outside the rows drawn', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useCatchUp();
    });
    act(() => {
      result.current.drawn.current = [100, 160];
    });
    const before = renders;
    // Inside what is drawn, or not from a scroll: left to the frame.
    result.current.onChange({ range: { startIndex: 110, endIndex: 130 } }, true);
    result.current.onChange({ range: { startIndex: 0, endIndex: 20 } }, false);
    expect(renders).toBe(before);
    // A jump to the top: drawn now.
    result.current.onChange({ range: { startIndex: 0, endIndex: 20 } }, true);
    expect(renders).toBe(before + 1);
  });
});
