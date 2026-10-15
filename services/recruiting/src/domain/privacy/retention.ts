import type { CalendarDate, LaunchCountry } from '@kithena/contracts';

import { addDays, addMonths } from '../dates.js';

/**
 * Consent and retention per country (Recruiting PRD §13.2, §24.2, REC-033).
 * **Awaiting a country reviewer** (REC-150).
 */

export interface RetentionRule {
  /** Months after the decision a rejected or withdrawn candidate is kept. */
  readonly rejectedMonths: number;
  /** Months a talent pool consent lasts. */
  readonly poolMonths: number;
  readonly source: string;
}

export const RETENTION: Readonly<Record<LaunchCountry, RetentionRule>> = {
  DE: {
    rejectedMonths: 6,
    poolMonths: 12,
    source: 'AGG § 15(4), § 61b ArbGG: 2 months to claim, 3 to sue, plus margin',
  },
  ES: {
    rejectedMonths: 6,
    poolMonths: 12,
    source: 'GDPR art. 5(1)(e); limitation periods to be confirmed',
  },
  GB: {
    rejectedMonths: 6,
    poolMonths: 12,
    source: 'Equality Act 2010 s. 123: 3 months to claim, plus margin',
  },
  IN: { rejectedMonths: 6, poolMonths: 12, source: 'DPDP Act 2023 s. 8(7): purpose limitation' },
  US: { rejectedMonths: 12, poolMonths: 24, source: '29 CFR 1602.14: at least one year' },
};

/** The stricter rule where a job spans countries: the longest the law needs, the shortest a pool lasts. */
export function retentionFor(countries: readonly LaunchCountry[]): RetentionRule {
  const rules = countries.length === 0 ? [RETENTION.DE] : countries.map((c) => RETENTION[c]);
  return {
    rejectedMonths: Math.max(...rules.map((r) => r.rejectedMonths)),
    poolMonths: Math.min(...rules.map((r) => r.poolMonths)),
    source: rules.map((r) => r.source).join('; '),
  };
}

export interface Retained {
  readonly candidateId: string;
  /** The latest decision across the candidate's applications; null while one is active. */
  readonly decidedOn: CalendarDate | null;
  readonly countries: readonly LaunchCountry[];
  readonly hired: boolean;
  readonly legalHold: boolean;
  /** An unexpired pool consent keeps the candidate. */
  readonly poolConsentUntil: CalendarDate | null;
}

export type RetentionAction =
  { readonly kind: 'keep'; readonly until: CalendarDate | null } | { readonly kind: 'anonymise' };

/**
 * What the retention sweep does with a candidate today (PRD §24.2): a hire
 * and a legal hold are kept; an active application keeps them; otherwise
 * they are kept until the later of the retention period and their pool
 * consent, then anonymised — personal data deleted, the stage history,
 * source, dates and reasons kept for analytics.
 */
export function retentionAction(r: Retained, today: CalendarDate): RetentionAction {
  if (r.hired || r.legalHold || r.decidedOn === null) return { kind: 'keep', until: null };
  const law = addMonths(r.decidedOn, retentionFor(r.countries).rejectedMonths);
  const until = r.poolConsentUntil !== null && r.poolConsentUntil > law ? r.poolConsentUntil : law;
  return today >= until ? { kind: 'anonymise' } : { kind: 'keep', until };
}

/** A pool consent: its expiry, and the day to ask for renewal, 30 days before (PRD §13.2). */
export function poolConsent(
  givenOn: CalendarDate,
  countries: readonly LaunchCountry[],
): { expiresOn: CalendarDate; askRenewalOn: CalendarDate } {
  const expiresOn = addMonths(givenOn, retentionFor(countries).poolMonths);
  return { expiresOn, askRenewalOn: addDays(expiresOn, -30) };
}

/** A sourced profile is told within one month (GDPR art. 14(3)(a)). */
export const notifySourcedBy = (addedOn: CalendarDate): CalendarDate => addMonths(addedOn, 1);
