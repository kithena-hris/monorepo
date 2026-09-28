import { describe, expect, it } from 'vitest';

import { binValues, radarPoints, squarify, type Rect } from './geometry';

const area = (rect: Rect): number => rect.width * rect.height;
const aspect = (rect: Rect): number => Math.max(rect.width / rect.height, rect.height / rect.width);

describe('squarify', () => {
  const box: Rect = { x: 0, y: 0, width: 6, height: 4 };

  it('reproduces the worked example from the paper', () => {
    // Bruls et al. lay 6, 6, 4, 3, 2, 2, 1 into a 6 x 4 box.
    const rects = squarify([6, 6, 4, 3, 2, 2, 1], box);
    expect(rects[0]).toEqual({ x: 0, y: 0, width: 3, height: 2 });
    expect(rects[1]).toEqual({ x: 0, y: 2, width: 3, height: 2 });
    expect(rects[2]?.x).toBeCloseTo(3);
    expect(rects[2]?.width).toBeCloseTo(12 / 7);
  });

  it('gives every value an area proportional to it and fills the box', () => {
    const values = [612, 248, 156, 118, 84, 66];
    const rects = squarify(values, { x: 0, y: 0, width: 100, height: 60 });
    const total = values.reduce((a, b) => a + b, 0);
    rects.forEach((rect, index) => {
      expect(area(rect)).toBeCloseTo(((values[index] ?? 0) / total) * 6000, 6);
      expect(rect.x).toBeGreaterThanOrEqual(-1e-9);
      expect(rect.y).toBeGreaterThanOrEqual(-1e-9);
      expect(rect.x + rect.width).toBeLessThanOrEqual(100 + 1e-9);
      expect(rect.y + rect.height).toBeLessThanOrEqual(60 + 1e-9);
    });
    expect(rects.reduce((sum, rect) => sum + area(rect), 0)).toBeCloseTo(6000, 6);
  });

  it('keeps the input order even though it lays out largest first', () => {
    const rects = squarify([1, 9], box);
    expect(area(rects[1] ?? box)).toBeGreaterThan(area(rects[0] ?? box));
  });

  it('keeps cells close to square', () => {
    const rects = squarify([5, 5, 5, 5, 5, 5], { x: 0, y: 0, width: 3, height: 2 });
    for (const rect of rects) expect(aspect(rect)).toBeLessThanOrEqual(1.5);
  });

  it('gives zero and negative values an empty cell without shifting the others', () => {
    const rects = squarify([4, 0, -2, 4], box);
    expect(area(rects[1] ?? box)).toBe(0);
    expect(area(rects[2] ?? box)).toBe(0);
    expect(area(rects[0] ?? box)).toBeCloseTo(12);
    expect(area(rects[3] ?? box)).toBeCloseTo(12);
  });

  it('returns empty cells when there is nothing to lay out', () => {
    expect(squarify([0, 0], box).every((rect) => area(rect) === 0)).toBe(true);
    expect(squarify([], box)).toEqual([]);
  });
});

describe('binValues', () => {
  it('counts into half-open bins, so an edge value lands in the bin it starts', () => {
    const bins = binValues([40, 49, 50, 59.9, 60], { step: 10 });
    expect(bins.map((bin) => [bin.from, bin.to, bin.count])).toEqual([
      [40, 50, 2],
      [50, 60, 2],
      [60, 70, 1],
    ]);
  });

  it('is not moved by floating-point drift', () => {
    const bins = binValues([0.3], { step: 0.1, start: 0, end: 0.5 });
    const hit = bins.find((bin) => bin.count === 1);
    expect(hit?.from).toBeCloseTo(0.3);
  });

  it('adds open bins below start and above end when they are given', () => {
    const bins = binValues([0.4, 1, 2.5, 6, 9], { step: 1, start: 1, end: 6 });
    expect(bins[0]).toEqual({ from: -Infinity, to: 1, count: 1 });
    expect(bins.at(-1)).toEqual({ from: 6, to: Infinity, count: 2 });
    expect(bins.slice(1, -1).map((bin) => bin.count)).toEqual([1, 1, 0, 0, 0]);
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(5);
  });

  it('leaves out an open bin with nothing in it', () => {
    const bins = binValues([44, 55, 140], { step: 10, start: 40, end: 130 });
    expect(bins[0]?.from).toBe(40);
    expect(bins.at(-1)).toEqual({ from: 130, to: Infinity, count: 1 });
  });

  it('ignores values that are not finite', () => {
    const bins = binValues([1, Number.NaN, Infinity, 2], { step: 1 });
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(2);
  });

  it('refuses a step that cannot make bins', () => {
    expect(() => binValues([1], { step: 0 })).toThrow(RangeError);
  });
});

describe('radarPoints', () => {
  const center = { x: 100, y: 100 };

  it('starts straight up and runs clockwise', () => {
    const [top, right, bottom, left] = radarPoints([5, 5, 5, 5], 5, 50, center);
    expect(top?.[0]).toBeCloseTo(100);
    expect(top?.[1]).toBeCloseTo(50);
    expect(right?.[0]).toBeCloseTo(150);
    expect(right?.[1]).toBeCloseTo(100);
    expect(bottom?.[1]).toBeCloseTo(150);
    expect(left?.[0]).toBeCloseTo(50);
  });

  it('scales each value to its share of the radius and clamps to the scale', () => {
    const [half, over, under] = radarPoints([2.5, 9, -1], 5, 50, center);
    expect(half?.[1]).toBeCloseTo(75);
    // Over the scale sits on the outer ring, under it sits on the centre.
    expect(Math.hypot((over?.[0] ?? 0) - 100, (over?.[1] ?? 0) - 100)).toBeCloseTo(50);
    expect(under).toEqual([100, 100]);
  });
});
