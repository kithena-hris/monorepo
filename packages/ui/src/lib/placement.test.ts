import { describe, expect, it } from 'vitest';

import { allRequiredFilled, isFilled, nextToFill, readingOrder } from './placement';

const box = (id: string, page: number, y: number, x: number, required = true) => ({
  id,
  page,
  x,
  y,
  required,
});

describe('boxes on a document, in reading order', () => {
  const boxes = [box('b', 2, 0.1, 0.1), box('c', 1, 0.5, 0.6), box('a', 1, 0.5, 0.2)];

  it('runs page by page, then down, then across', () => {
    expect(boxes.toSorted(readingOrder).map((b) => b.id)).toEqual(['a', 'c', 'b']);
  });

  it('counts a taken-back tick as unfilled', () => {
    expect(isFilled('true')).toBe(true);
    expect(isFilled('false')).toBe(false);
    expect(isFilled('')).toBe(false);
    expect(isFilled(undefined)).toBe(false);
  });

  it('walks to the next unfilled box, past an optional one nobody must fill', () => {
    const tick = box('t', 1, 0.1, 0.1, false);
    const all = [...boxes, tick];
    expect(nextToFill(all, {}, (b) => b.id === 't')?.id).toBe('a');
    expect(nextToFill(all, { a: 'x', c: 'x' }, (b) => b.id === 't')?.id).toBe('b');
    expect(nextToFill(all, { a: 'x', c: 'x', b: 'x' }, (b) => b.id === 't')).toBeNull();
    // An optional box that is not skippable is still a step.
    expect(nextToFill([tick], {})?.id).toBe('t');
  });

  it('is complete once every required box is filled', () => {
    expect(allRequiredFilled(boxes, { a: 'x', c: 'x' })).toBe(false);
    expect(
      allRequiredFilled([...boxes, box('o', 3, 0, 0, false)], { a: 'x', b: 'x', c: 'x' }),
    ).toBe(true);
  });
});
