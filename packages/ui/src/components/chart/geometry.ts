/**
 * The arithmetic behind the charts that cannot be drawn with a percentage.
 *
 * Pure functions, no React and no DOM, so the part of a chart most likely to
 * be wrong is the part that is cheapest to test.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Squarified treemap layout (Bruls, Huizing and van Wijk, 2000).
 *
 * Returns one rectangle per value, **in the order the values were given**, so
 * the caller can zip the result back onto its own items. Internally the values
 * are laid out largest first, one row at a time along the shorter side of the
 * space left, and a value joins the current row only while doing so makes the
 * row's worst aspect ratio better. That is what keeps the cells close to
 * square, and a square is the only shape whose area the eye can compare.
 *
 * A zero or negative value gets an empty rectangle rather than being dropped,
 * so indices never shift under the caller.
 */
export function squarify(values: readonly number[], box: Rect): Rect[] {
  const out: Rect[] = values.map(() => ({ x: box.x, y: box.y, width: 0, height: 0 }));
  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0);
  if (total <= 0 || box.width <= 0 || box.height <= 0) return out;

  const scale = (box.width * box.height) / total;
  const order = values
    .map((value, index) => ({ index, area: Math.max(value, 0) * scale }))
    .filter((entry) => entry.area > 0)
    .toSorted((a, b) => b.area - a.area);

  let space: Rect = { ...box };
  let row: typeof order = [];

  // The worst (largest) aspect ratio in a row laid along a side of `side`.
  const worst = (entries: typeof order, side: number): number => {
    const sum = entries.reduce((acc, entry) => acc + entry.area, 0);
    let result = 0;
    for (const entry of entries) {
      const ratio = Math.max(
        (side * side * entry.area) / (sum * sum),
        (sum * sum) / (side * side * entry.area),
      );
      result = Math.max(result, ratio);
    }
    return result;
  };

  const place = (entries: typeof order): void => {
    const sum = entries.reduce((acc, entry) => acc + entry.area, 0);
    if (space.width >= space.height) {
      // A column down the left of what is left.
      const width = sum / space.height;
      let y = space.y;
      for (const entry of entries) {
        const height = entry.area / width;
        out[entry.index] = { x: space.x, y, width, height };
        y += height;
      }
      space = { ...space, x: space.x + width, width: space.width - width };
    } else {
      // A row across the top of what is left.
      const height = sum / space.width;
      let x = space.x;
      for (const entry of entries) {
        const width = entry.area / height;
        out[entry.index] = { x, y: space.y, width, height };
        x += width;
      }
      space = { ...space, y: space.y + height, height: space.height - height };
    }
  };

  for (const entry of order) {
    const side = Math.min(space.width, space.height);
    if (row.length === 0 || worst([...row, entry], side) <= worst(row, side)) {
      row.push(entry);
    } else {
      place(row);
      row = [entry];
    }
  }
  if (row.length > 0) place(row);

  return out;
}

export interface HistogramBin {
  /** Inclusive lower edge. `-Infinity` for the open "below" bin. */
  from: number;
  /** Exclusive upper edge. `Infinity` for the open "above" bin. */
  to: number;
  count: number;
}

export interface BinOptions {
  /** Width of every closed bin. */
  step: number;
  /**
   * First closed edge. When given, values under it are counted in an open
   * "below" bin at the front (present only when something is in it), so a tenure chart can say "under a year" without
   * a bin stretching back to zero. Defaults to the minimum, rounded down to a
   * multiple of `step`.
   */
  start?: number;
  /**
   * Last closed edge. When given, values at or over it are counted in an open
   * "above" bin at the end (present only when something is in it), which is what "130k+" is. Defaults to just past the
   * maximum.
   */
  end?: number;
}

/**
 * Counts values into equal-width, half-open bins: `[from, to)`.
 *
 * Half-open so a value on an edge is counted once, in the bin it starts. The
 * edges are computed from the index rather than by adding `step` repeatedly,
 * so 0.1 + 0.1 + 0.1 drift cannot move a value into its neighbour. Values that
 * are not finite are ignored: a `NaN` salary is missing data, not a bin.
 */
export function binValues(values: readonly number[], options: BinOptions): HistogramBin[] {
  const { step } = options;
  if (!(step > 0)) throw new RangeError('binValues: step must be greater than zero');

  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0 && options.start === undefined && options.end === undefined) return [];

  const min = finite.length > 0 ? Math.min(...finite) : (options.start ?? 0);
  const max = finite.length > 0 ? Math.max(...finite) : (options.end ?? min);
  const lo = options.start ?? Math.floor(min / step) * step;
  // One past the bin holding the maximum, so the maximum is inside a
  // half-open bin rather than sitting on its closing edge.
  const hi = options.end ?? (Math.floor(max / step + 1e-9) + 1) * step;
  const count = Math.max(0, Math.round((hi - lo) / step));

  const closed: HistogramBin[] = Array.from({ length: count }, (_, index) => ({
    from: lo + index * step,
    to: lo + (index + 1) * step,
    count: 0,
  }));
  const below: HistogramBin = { from: -Infinity, to: lo, count: 0 };
  const above: HistogramBin = { from: hi, to: Infinity, count: 0 };

  for (const value of finite) {
    if (value < lo) below.count += 1;
    else if (value >= hi) above.count += 1;
    else {
      // The epsilon absorbs (0.3 - 0) / 0.1 = 2.9999999999999996.
      const index = Math.min(count - 1, Math.floor((value - lo) / step + 1e-9));
      const bin = closed[index];
      if (bin) bin.count += 1;
    }
  }

  // An open bin only when something is in it: an empty "<40" at the front of
  // a salary chart is an axis label for nobody.
  return [...(below.count > 0 ? [below] : []), ...closed, ...(above.count > 0 ? [above] : [])];
}

/**
 * The vertices of a radar polygon, first axis straight up, then clockwise.
 *
 * Values are clamped to `[0, max]`: a score over the scale would draw outside
 * the outer ring and read as a different chart.
 */
export function radarPoints(
  values: readonly number[],
  max: number,
  radius: number,
  center: { x: number; y: number },
): [number, number][] {
  const count = values.length;
  return values.map((value, index) => {
    const r = max > 0 ? (Math.min(Math.max(value, 0), max) / max) * radius : 0;
    const angle = (2 * Math.PI * index) / count;
    return [center.x + r * Math.sin(angle), center.y - r * Math.cos(angle)];
  });
}
