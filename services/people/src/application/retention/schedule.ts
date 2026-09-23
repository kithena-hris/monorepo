import type { Classification, FieldPolicy, RetentionPolicy } from '@kithena/contracts';

/**
 * When a leaver's values may be anonymised (PRD §6.2, §8.1).
 *
 * Counted from the last working day, per attribute, from the attribute's own
 * `FieldPolicy.retention` — the same policy the redaction paths, the AI deny
 * list and the DSAR manifest read. A field with no retention policy is never
 * cleared by this job: kept is the reversible mistake.
 *
 * **A statutory floor is not the tenant's to shorten.** The effective period is
 * the longer of the tenant's months and the floor's, and the decision records
 * which one it was, because `people.person.anonymised` has to tell an auditor
 * law from configuration.
 */

/**
 * Months each floor holds a record after employment ends.
 *
 * `ponytail: one number per jurisdiction, and these need a lawyer's sign-off
 * before a customer relies on them. es-labour: 4 years, the LISOS art. 21
 * limitation for labour infringements. de-labour: 6 years, HGB §257 for
 * business correspondence. eu-payroll: 10 years, the longest tax-record
 * retention among the member states we sell to (e.g. AO §147).`
 */
export const STATUTORY_FLOOR_MONTHS: Readonly<
  Record<NonNullable<RetentionPolicy['statutoryFloor']>, number>
> = {
  'es-labour': 48,
  'de-labour': 72,
  'eu-payroll': 120,
};

export interface RetentionDecision {
  readonly key: string;
  readonly classification: Classification;
  /** The first day the value may be cleared. */
  readonly dueOn: string;
  readonly under: 'tenant_policy' | 'statutory_floor';
}

const daysIn = (year: number, month: number): number =>
  [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month
  ] ?? 31;

/** A calendar date plus whole months, clamped to the end of a shorter month. Pure: no clock, no time zone. */
export function addMonths(date: string, months: number): string {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = total % 12;
  const day = Math.min(d, daysIn(year, month));
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Which attributes may be cleared on `today`, given the last working day. */
export function dueForAnonymisation(
  attributes: readonly { readonly key: string; readonly policy: FieldPolicy }[],
  lastWorkingDay: string,
  today: string,
): readonly RetentionDecision[] {
  const due: RetentionDecision[] = [];

  for (const { key, policy } of attributes) {
    const retention = policy.retention;
    if (!retention) continue;

    const floor = retention.statutoryFloor ? STATUTORY_FLOOR_MONTHS[retention.statutoryFloor] : 0;
    const months = Math.max(retention.monthsAfterTermination, floor);
    const dueOn = addMonths(lastWorkingDay, months);
    if (dueOn > today) continue;

    due.push({
      key,
      classification: policy.classification,
      dueOn,
      under: floor > retention.monthsAfterTermination ? 'statutory_floor' : 'tenant_policy',
    });
  }

  return due;
}
