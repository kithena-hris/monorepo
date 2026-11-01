import { describe, expect, it } from 'vitest';

import { drawAhead } from './draw-ahead';

const range = { startIndex: 100, endIndex: 110, overscan: 5, count: 5000 };

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
    expect(drawAhead(() => 'forward', 50)({ ...range, endIndex: 4990 })).toHaveLength(5000 - 95);
    expect(drawAhead(() => 'backward', 50)({ ...range, startIndex: 10 }).at(0)).toBe(0);
  });

  it('draws every loaded row while there are few enough, so none is ever shown empty', () => {
    expect(drawAhead(() => null, 50)({ ...range, count: 300 })).toHaveLength(300);
    expect(drawAhead(() => 'forward', 50, 100)({ ...range, count: 300 })).toHaveLength(71);
  });
});
