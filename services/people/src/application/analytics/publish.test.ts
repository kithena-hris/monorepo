import { describe, expect, it } from 'vitest';

import { chartExport, chartTooltip } from './access.js';
import { publicationDue, roundToFive, ROUNDING_NOTE, servePublished } from './publish.js';

/**
 * PEO-083: a special-category breakdown is served from a publication, not
 * from the live snapshot, so two readings a day apart cannot be subtracted to
 * find the one person who joined in between.
 */

describe('rounding to the nearest five', () => {
  it('rounds down and up to the nearest multiple', () => {
    expect(roundToFive(12)).toBe(10);
    expect(roundToFive(13)).toBe(15);
    expect(roundToFive(10)).toBe(10);
    expect(roundToFive(0)).toBe(0);
  });

  it('breaks a tie away from zero', () => {
    expect(roundToFive(2.5)).toBe(5);
    expect(roundToFive(7.5)).toBe(10);
    expect(roundToFive(-2.5)).toBe(-5);
  });
});

describe('when a new breakdown is published', () => {
  const due = (over: Partial<Parameters<typeof publicationDue>[0]>) =>
    publicationDue({
      today: '2026-04-01',
      previousRun: '2026-03-31',
      lastPublishedOn: '2026-03-01',
      changes: 10,
      threshold: 10,
      ...over,
    });

  it('publishes the first one straight away, with nothing to difference it against', () => {
    expect(
      due({ today: '2026-03-12', previousRun: '2026-03-11', lastPublishedOn: null, changes: 0 }),
    ).toBe(true);
  });

  it('republishes at the month boundary once enough people changed', () => {
    expect(due({})).toBe(true);
  });

  it('does not republish on nine changes', () => {
    expect(due({ changes: 9 })).toBe(false);
  });

  it('waits for the boundary: ten changes by the 12th publish on the 1st, not the 12th', () => {
    expect(due({ today: '2026-03-12', previousRun: '2026-03-11' })).toBe(false);
    expect(due({ today: '2026-04-01', previousRun: '2026-03-31' })).toBe(true);
  });

  it('treats the first run of a month as its boundary when the 1st was missed', () => {
    expect(due({ today: '2026-04-03', previousRun: '2026-03-30' })).toBe(true);
  });

  it('publishes at most once in a calendar month', () => {
    expect(
      due({ today: '2026-04-01', previousRun: '2026-03-31', lastPublishedOn: '2026-04-01' }),
    ).toBe(false);
  });

  it('raises the threshold with the cohort minimum', () => {
    expect(due({ changes: 24, threshold: 25 })).toBe(false);
    expect(due({ changes: 25, threshold: 25 })).toBe(true);
  });
});

describe('serving a publication', () => {
  const publication = (counts: number[], population: number) => ({
    publishedOn: '2026-03-01',
    population,
    cells: counts.map((count, i) => ({ bucket: `b${String(i)}`, count })),
  });

  it('says "insufficient data" before anything has been published', () => {
    expect(servePublished(null, 10)).toEqual({
      publishedAsOf: null,
      rounded: 5,
      note: ROUNDING_NOTE,
      status: 'insufficient_data',
      minimum: 10,
    });
  });

  it('rounds every cell and rounds the total on its own, not as a sum of rounded cells', () => {
    // 12 + 12 + 12 = 36: rounded cells sum to 30, the rounded total is 35.
    expect(servePublished(publication([12, 12, 12], 36), 10)).toEqual({
      publishedAsOf: '2026-03-01',
      rounded: 5,
      note: ROUNDING_NOTE,
      status: 'ok',
      total: 35,
      cells: [
        { bucket: 'b0', count: 10 },
        { bucket: 'b1', count: 10 },
        { bucket: 'b2', count: 10 },
      ],
    });
  });

  it('withholds on the true counts, although rounding would lift an 8 to 10', () => {
    expect(servePublished(publication([40, 8], 48), 10)).toEqual({
      publishedAsOf: '2026-03-01',
      rounded: 5,
      note: ROUNDING_NOTE,
      status: 'insufficient_data',
      minimum: 10,
    });
  });

  it('holds a raised minimum against a publication made under a lower one', () => {
    expect(servePublished(publication([12, 13], 25), 13)).toMatchObject({
      status: 'insufficient_data',
      minimum: 13,
    });
  });

  it('gives the tooltip and the export the same rounded numbers as the chart', () => {
    const served = servePublished(publication([12, 13], 25), 10);
    expect(chartTooltip(served, 'b0')).toEqual({ bucket: 'b0', value: 10 });
    expect(chartTooltip(served, 'b1')).toEqual({ bucket: 'b1', value: 15 });
    expect(chartExport(served)).toEqual([
      ['bucket', 'count'],
      ['b0', 10],
      ['b1', 15],
      ['total', 25],
      [ROUNDING_NOTE, ''],
    ]);
  });
});
