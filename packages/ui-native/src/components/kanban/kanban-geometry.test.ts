import { describe, expect, it } from 'vitest';

import { GAP, indexAt, laneAt, moveWithin, offsetOf, type Lane } from './kanban-geometry.ts';

const lane = (id: string, x: number, heights: number[]): Lane => ({
  id,
  x,
  w: 300,
  left: 10,
  top: 40,
  locked: false,
  full: false,
  cards: heights.map((h, i) => ({ id: `${id}${String(i)}`, h })),
});

describe('the drag arithmetic', () => {
  const a = lane('a', 0, [100, 60, 80]);

  it('places a slot after the cards before it, skipping the lifted one', () => {
    expect(offsetOf(a, '', 2)).toBe(100 + GAP + 60 + GAP);
    expect(offsetOf(a, 'a0', 1)).toBe(60 + GAP);
  });

  it('takes a slot once the centre crosses a card’s middle', () => {
    expect(indexAt(a, 'a1', 49)).toBe(0);
    expect(indexAt(a, 'a1', 51)).toBe(1);
    expect(indexAt(a, 'a1', 10_000)).toBe(2);
  });

  it('picks the column whose centre is nearest', () => {
    const g = { lanes: [a, lane('b', 312, [])], frameW: 358, frameH: 400, contentW: 612 };
    expect(laneAt(g, 300)?.id).toBe('a');
    expect(laneAt(g, 320)?.id).toBe('b');
  });

  it('moves a card across columns and within one, as the web does', () => {
    const board = { a: [{ id: '1' }, { id: '2' }], b: [{ id: '3' }] };
    expect(moveWithin(board, '1', 'a', 'b', 0)).toEqual({
      a: [{ id: '2' }],
      b: [{ id: '1' }, { id: '3' }],
    });
    expect(moveWithin(board, '1', 'a', 'a', 1)['a']).toEqual([{ id: '2' }, { id: '1' }]);
    expect(moveWithin(board, 'x', 'a', 'b', 0)).toBe(board);
  });
});
