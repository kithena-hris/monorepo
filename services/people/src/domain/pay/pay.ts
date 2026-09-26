import { Decimal as DecimalJs } from 'decimal.js';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { CalendarDate } from '@kithena/contracts';

/**
 * Pay bands, and pay in aggregate (PEO-078; PRD §16.2). Pure.
 *
 * Every amount here is in **minor units**, as a `Decimal`: the application
 * converts at its edges, and nothing in this file ever holds a float. A band
 * is People's until a Compensation module takes it over, which is why it is
 * effective-dated and raises its own event.
 *
 * ### What an aggregate may say
 *
 * Quartiles — the 25th percentile, the median and the 75th — per group, and
 * how many people the group holds. Never a minimum or a maximum, which are one
 * person's salary, and never a group below the cohort minimum: such a group
 * says that it exists and nothing else, no count and no figure, because a
 * median of three is a salary somebody can name.
 *
 * A group is one currency, always. A median of euros and pounds is not a
 * number of anything.
 */

/** Enough places that no salary a person earns is rounded before we mean it to be. */
export const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_EVEN });
export type Decimal = DecimalJs;

/** The floor under any cohort minimum (§16.1). The same ten the snapshot holds. */
const FLOOR = 10;

/** Compa-ratio to four places: 0.9875. */
export const RATIO_PLACES = 4;

/** Anybody who may maintain the bands: HR, or finance. */
export const mayEditPayBands = (roles: ReadonlySet<string>): boolean =>
  roles.has('hr') || roles.has('finance');

/**
 * Anybody who may see pay in aggregate: finance, which is the relation §16.2
 * names. HR reads salaries on a profile; a manager never sees pay here.
 */
export const maySeePay = (roles: ReadonlySet<string>): boolean => roles.has('finance');

export interface PayBand {
  readonly grade: string;
  readonly currency: string;
  readonly minimum: Decimal;
  readonly midpoint: Decimal;
  readonly maximum: Decimal;
  /** The day it takes effect. */
  readonly effectiveFrom: string;
}

export interface PayBandInput {
  readonly grade: string;
  readonly currency: string;
  /** Whole minor units, as digits: `"5000000"` is 50,000.00 EUR. */
  readonly minimumMinor: string;
  readonly midpointMinor: string;
  readonly maximumMinor: string;
  readonly effectiveFrom: string;
}

// Fifteen digits: what `numeric(19,4)` holds whole, for a currency with no minor unit.
const MINOR = /^[1-9]\d{0,14}$/u;

/** A band as somebody typed it, or the reason it is not one. */
export function payBand(input: PayBandInput): Result<PayBand> {
  const grade = input.grade.trim();
  if (grade.length === 0 || grade.length > 64) {
    return err(failure('VALUE_INVALID', 'A grade is 1 to 64 characters', ['grade']));
  }
  if (!/^[A-Z]{3}$/u.test(input.currency)) {
    return err(failure('VALUE_INVALID', 'A currency is a three-letter ISO code', ['currency']));
  }
  if (!CalendarDate.safeParse(input.effectiveFrom).success) {
    return err(failure('VALUE_INVALID', 'effectiveFrom is a calendar date', ['effectiveFrom']));
  }
  for (const key of ['minimumMinor', 'midpointMinor', 'maximumMinor'] as const) {
    if (!MINOR.test(input[key])) {
      return err(
        failure('VALUE_INVALID', `${key} is a positive whole number of minor units`, [key]),
      );
    }
  }
  const minimum = new Decimal(input.minimumMinor);
  const midpoint = new Decimal(input.midpointMinor);
  const maximum = new Decimal(input.maximumMinor);
  if (minimum.gt(midpoint) || midpoint.gt(maximum)) {
    return err(
      failure('PAY_BAND_ORDER', 'A band runs minimum, then midpoint, then maximum', [
        'midpointMinor',
      ]),
    );
  }
  return ok({
    grade,
    currency: input.currency,
    minimum,
    midpoint,
    maximum,
    effectiveFrom: input.effectiveFrom,
  });
}

export interface Quartiles {
  readonly p25: Decimal;
  readonly median: Decimal;
  readonly p75: Decimal;
}

/**
 * The 25th, 50th and 75th percentiles, interpolated between ranks as
 * Excel's `PERCENTILE.INC` and R's type 7 do, so finance can check one in a
 * spreadsheet and get the same answer. Rounded half to even at `places`.
 */
export function quartiles(values: readonly Decimal[], places: number): Quartiles {
  if (values.length === 0) throw new Error('No quartiles of nothing');
  const sorted = values.map((v) => new Decimal(v)).toSorted((a, b) => a.comparedTo(b));
  const at = (p: number): Decimal => {
    const position = new Decimal(sorted.length - 1).times(p);
    const lo = position.floor().toNumber();
    const hi = position.ceil().toNumber();
    const low = sorted[lo] as Decimal;
    const high = sorted[hi] as Decimal;
    return low
      .plus(high.minus(low).times(position.minus(lo)))
      .toDecimalPlaces(places, Decimal.ROUND_HALF_EVEN);
  };
  return { p25: at(0.25), median: at(0.5), p75: at(0.75) };
}

/** One present person, as the snapshot reads them in memory. Never stored. */
export interface PayFact {
  readonly grade: string | null;
  readonly tenureBand: string;
  readonly salary: { readonly amount: Decimal; readonly currency: string };
}

/**
 * `grade`: salary per grade. `tenure`: salary per tenure band, pay against
 * tenure without a point per person. `compa`: salary over the midpoint of the
 * band for that grade and currency.
 */
export type PayMeasure = 'grade' | 'tenure' | 'compa';

export interface PayGroup {
  readonly measure: PayMeasure;
  readonly bucket: string;
  readonly currency: string;
  /** Null when withheld: below the minimum, a group has no count either. */
  readonly people: number | null;
  readonly quartiles: Quartiles | null;
}

/**
 * Every group's quartiles, or its withholding.
 *
 * Salary quartiles are whole minor units; compa-ratio quartiles are to
 * `RATIO_PLACES`. `minimum` is the tenant's cohort minimum, never below ten.
 */
export function payGroups(
  facts: readonly PayFact[],
  bands: readonly PayBand[],
  minimum: number,
): PayGroup[] {
  const floor = Math.max(minimum, FLOOR);
  const midpoints = new Map(bands.map((b) => [`${b.grade}\u0000${b.currency}`, b.midpoint]));
  const groups = new Map<
    string,
    { measure: PayMeasure; bucket: string; currency: string; values: Decimal[] }
  >();
  const add = (measure: PayMeasure, bucket: string, currency: string, value: Decimal): void => {
    const key = [measure, bucket, currency].join('\u0000');
    const group = groups.get(key) ?? { measure, bucket, currency, values: [] };
    group.values.push(value);
    groups.set(key, group);
  };

  for (const { grade, tenureBand, salary } of facts) {
    add('tenure', tenureBand, salary.currency, salary.amount);
    if (grade === null) continue;
    add('grade', grade, salary.currency, salary.amount);
    const midpoint = midpoints.get(`${grade}\u0000${salary.currency}`);
    if (midpoint !== undefined) add('compa', grade, salary.currency, salary.amount.div(midpoint));
  }

  return [...groups.values()]
    .map(({ values, ...group }): PayGroup => {
      if (values.length < floor) return { ...group, people: null, quartiles: null };
      return {
        ...group,
        people: values.length,
        quartiles: quartiles(values, group.measure === 'compa' ? RATIO_PLACES : 0),
      };
    })
    .toSorted(
      (a, b) =>
        a.measure.localeCompare(b.measure) ||
        a.bucket.localeCompare(b.bucket) ||
        a.currency.localeCompare(b.currency),
    );
}
