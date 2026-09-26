import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  mayEditPayBands,
  maySeePay,
  payBand,
  payGroups,
  quartiles,
  type PayBand,
  type PayFact,
} from './pay.js';

const d = (v: string | number) => new Decimal(v);
const q = (values: (string | number)[], places = 0) => {
  const r = quartiles(values.map(d), places);
  return { p25: r.p25.toString(), median: r.median.toString(), p75: r.p75.toString() };
};

describe('quartiles', () => {
  it('interpolates between ranks, as PERCENTILE.INC does', () => {
    expect(q([1, 2, 3, 4], 2)).toEqual({ p25: '1.75', median: '2.5', p75: '3.25' });
    expect(q([10, 20, 30, 40, 50])).toEqual({ p25: '20', median: '30', p75: '40' });
  });

  it('does not care what order the values arrive in', () => {
    expect(q([40, 10, 50, 30, 20])).toEqual(q([10, 20, 30, 40, 50]));
  });

  it('is exact where a float is not', () => {
    // 0.1 + 0.2 in a float is 0.30000000000000004; halfway between them is not 0.15000000000000002.
    expect(q(['0.1', '0.2'], 4).median).toBe('0.15');
    // Salaries past 2^53 minor units still order and interpolate exactly.
    expect(q(['9007199254740993', '9007199254740995']).median).toBe('9007199254740994');
  });

  it('rounds half to even at the places asked for', () => {
    // Minor units: the median of 1 and 2 is 1.5, which is 2; of 2 and 3, 2.5, which is 2.
    expect(q([1, 2]).median).toBe('2');
    expect(q([2, 3]).median).toBe('2');
  });

  it('refuses an empty set rather than inventing a number', () => {
    expect(() => quartiles([], 0)).toThrow();
  });
});

const EUR = (grade: string, amount: number, tenureBand = '2_5y'): PayFact => ({
  grade,
  tenureBand,
  salary: { amount: d(amount), currency: 'EUR' },
});

const band = (over: Partial<PayBand> = {}): PayBand => ({
  grade: 'L3',
  currency: 'EUR',
  minimum: d(4_000_000),
  midpoint: d(5_000_000),
  maximum: d(6_000_000),
  effectiveFrom: '2026-01-01',
  ...over,
});

const ten = (grade: string, from: number, step = 100_000) =>
  Array.from({ length: 10 }, (_, i) => EUR(grade, from + i * step));

describe('payGroups', () => {
  it('serves quartiles for a group at the minimum, and nothing else about it', () => {
    const groups = payGroups(ten('L3', 4_500_000), [band()], 10);
    const grade = groups.find((g) => g.measure === 'grade');
    expect(grade).toMatchObject({ bucket: 'L3', currency: 'EUR', people: 10 });
    expect(grade?.quartiles?.median.toString()).toBe('4950000');
    expect(Object.keys(grade ?? {}).toSorted()).toEqual([
      'bucket',
      'currency',
      'measure',
      'people',
      'quartiles',
    ]);
    expect(Object.keys(grade?.quartiles ?? {}).toSorted()).toEqual(['median', 'p25', 'p75']);
  });

  it('withholds a group below the minimum with no number at all', () => {
    const groups = payGroups(
      [...ten('L3', 4_500_000), ...ten('L4', 6_000_000).slice(0, 9)],
      [],
      10,
    );
    const small = groups.find((g) => g.measure === 'grade' && g.bucket === 'L4');
    expect(small).toEqual({
      measure: 'grade',
      bucket: 'L4',
      currency: 'EUR',
      people: null,
      quartiles: null,
    });
  });

  it('never lowers the minimum below ten, whatever it is handed', () => {
    const groups = payGroups(ten('L3', 4_500_000).slice(0, 5), [], 3);
    expect(groups.every((g) => g.quartiles === null && g.people === null)).toBe(true);
  });

  it('never mixes currencies in one aggregate', () => {
    const gbp = Array.from({ length: 10 }, (_, i): PayFact => ({
      grade: 'L3',
      tenureBand: '2_5y',
      salary: { amount: d(100 + i), currency: 'GBP' },
    }));
    const groups = payGroups([...ten('L3', 4_500_000), ...gbp], [band()], 10).filter(
      (g) => g.measure === 'grade',
    );
    expect(groups.map((g) => [g.currency, g.people])).toEqual([
      ['EUR', 10],
      ['GBP', 10],
    ]);
    expect(groups.find((g) => g.currency === 'GBP')?.quartiles?.median.toString()).toBe('104'); // 104.5, half to even
  });

  it('groups pay against tenure by band, never by person', () => {
    const facts = [
      ...ten('L3', 4_500_000).map((f) => ({ ...f, tenureBand: '0_6m' })),
      ...ten('L4', 6_000_000).map((f) => ({ ...f, tenureBand: '0_6m' })),
    ];
    const tenure = payGroups(facts, [], 10).filter((g) => g.measure === 'tenure');
    expect(tenure).toHaveLength(1);
    expect(tenure[0]).toMatchObject({ bucket: '0_6m', currency: 'EUR', people: 20 });
  });

  it('takes compa-ratio against the midpoint of the band in the same grade and currency', () => {
    // 4.5m to 5.4m against a 5m midpoint: 0.9 to 1.08.
    const compa = payGroups(ten('L3', 4_500_000), [band()], 10).find((g) => g.measure === 'compa');
    expect(compa?.people).toBe(10);
    expect(compa?.quartiles?.median.toString()).toBe('0.99');
    expect(compa?.quartiles?.p25.toString()).toBe('0.945');
    expect(compa?.quartiles?.p75.toString()).toBe('1.035');
  });

  it('draws no compa-ratio without a band in that currency', () => {
    const groups = payGroups(ten('L3', 4_500_000), [band({ currency: 'GBP' })], 10);
    expect(groups.some((g) => g.measure === 'compa')).toBe(false);
  });

  it('leaves somebody with no grade out of the grade and compa groups only', () => {
    const facts = ten('L3', 4_500_000).map((f) => ({ ...f, grade: null }));
    const groups = payGroups(facts, [band()], 10);
    expect(groups.map((g) => g.measure)).toEqual(['tenure']);
  });
});

describe('payBand', () => {
  const input = {
    grade: ' L3 ',
    currency: 'EUR',
    minimumMinor: '4000000',
    midpointMinor: '5000000',
    maximumMinor: '6000000',
    effectiveFrom: '2026-01-01',
  };

  it('takes a band in minor units, trimmed', () => {
    const made = payBand(input);
    expect(made.ok && made.value.grade).toBe('L3');
    expect(made.ok && made.value.midpoint.toString()).toBe('5000000');
  });

  it('refuses a midpoint outside the range, and a range upside down', () => {
    expect(payBand({ ...input, midpointMinor: '7000000' })).toMatchObject({
      ok: false,
      error: { code: 'PAY_BAND_ORDER' },
    });
    expect(payBand({ ...input, minimumMinor: '6500000' })).toMatchObject({ ok: false });
  });

  it('refuses a fraction of a minor unit, a float, a zero and a bad currency', () => {
    for (const over of [
      { minimumMinor: '4000000.5' },
      { minimumMinor: '4e6' },
      { minimumMinor: '0' },
      { currency: 'eur' },
      { grade: '' },
      { effectiveFrom: '2026-02-30' },
    ]) {
      expect(payBand({ ...input, ...over }).ok, JSON.stringify(over)).toBe(false);
    }
  });
});

describe('who may do what', () => {
  it('lets HR and finance edit bands, and only finance see pay', () => {
    expect(mayEditPayBands(new Set(['hr']))).toBe(true);
    expect(mayEditPayBands(new Set(['finance']))).toBe(true);
    expect(mayEditPayBands(new Set(['people_admin']))).toBe(false);
    expect(maySeePay(new Set(['finance']))).toBe(true);
    expect(maySeePay(new Set(['hr', 'people_admin']))).toBe(false);
    expect(maySeePay(new Set())).toBe(false);
  });
});
