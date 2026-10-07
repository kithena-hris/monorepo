import { describe, expect, it } from 'vitest';

import {
  binValues,
  brushSelect,
  fitInto,
  indexAt,
  linearFit,
  moveBrush,
  radarPoints,
  squarify,
  type Rect,
} from './geometry.ts';

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

describe('linearFit', () => {
  it('recovers an exact line', () => {
    const fit = linearFit([
      { x: 1, y: 5 },
      { x: 2, y: 7 },
      { x: 3, y: 9 },
    ]);
    expect(fit?.slope).toBeCloseTo(2);
    expect(fit?.intercept).toBeCloseTo(3);
  });

  it('is the least-squares line through scattered points', () => {
    // Worked by hand: mean x 2.5, mean y 3.5, Sxy 5, Sxx 5.
    const fit = linearFit([
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 3 },
      { x: 4, y: 5 },
    ]);
    expect(fit?.slope).toBeCloseTo(0.8);
    expect(fit?.intercept).toBeCloseTo(1.5);
  });

  it('refuses to invent a line from one point or from no spread in x', () => {
    expect(linearFit([{ x: 1, y: 1 }])).toBeNull();
    expect(
      linearFit([
        { x: 2, y: 1 },
        { x: 2, y: 9 },
      ]),
    ).toBeNull();
  });

  it('ignores points that are not finite', () => {
    const fit = linearFit([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: Number.NaN, y: 40 },
    ]);
    expect(fit?.slope).toBeCloseTo(1);
  });
});

describe('brush maths', () => {
  const total = 12;

  it('maps a fraction of the strip to the nearest index, clamped', () => {
    expect(indexAt(0, total)).toBe(0);
    expect(indexAt(1, total)).toBe(11);
    expect(indexAt(0.5, total)).toBe(6);
    expect(indexAt(-0.2, total)).toBe(0);
    expect(indexAt(1.4, total)).toBe(11);
  });

  it('moves one edge without crossing the other', () => {
    expect(moveBrush({ start: 2, end: 6 }, 'start', 2, total)).toEqual({ start: 4, end: 6 });
    expect(moveBrush({ start: 2, end: 6 }, 'start', 9, total)).toEqual({ start: 5, end: 6 });
    expect(moveBrush({ start: 2, end: 6 }, 'start', -9, total)).toEqual({ start: 0, end: 6 });
    expect(moveBrush({ start: 2, end: 6 }, 'end', -9, total)).toEqual({ start: 2, end: 3 });
    expect(moveBrush({ start: 2, end: 6 }, 'end', 20, total)).toEqual({ start: 2, end: 11 });
  });

  it('pans the whole window and keeps its width at either end', () => {
    expect(moveBrush({ start: 2, end: 6 }, 'window', 3, total)).toEqual({ start: 5, end: 9 });
    expect(moveBrush({ start: 2, end: 6 }, 'window', 30, total)).toEqual({ start: 7, end: 11 });
    expect(moveBrush({ start: 2, end: 6 }, 'window', -30, total)).toEqual({ start: 0, end: 4 });
  });

  it('draws a new window in either direction, never narrower than two points', () => {
    expect(brushSelect(3, 8, total)).toEqual({ start: 3, end: 8 });
    expect(brushSelect(8, 3, total)).toEqual({ start: 3, end: 8 });
    expect(brushSelect(5, 5, total)).toEqual({ start: 5, end: 6 });
    expect(brushSelect(11, 11, total)).toEqual({ start: 10, end: 11 });
  });
});

describe('fitInto', () => {
  it('scales content down to fit and centres it on the spare axis', () => {
    const fit = fitInto({ width: 1200, height: 400 }, { width: 120, height: 76 });
    expect(fit.scale).toBeCloseTo(0.1);
    expect(fit.x).toBeCloseTo(0);
    expect(fit.y).toBeCloseTo((76 - 40) / 2);
  });

  it('survives an empty content box', () => {
    expect(fitInto({ width: 0, height: 0 }, { width: 120, height: 76 }).scale).toBe(0);
  });
});
