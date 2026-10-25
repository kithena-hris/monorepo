import { createHash } from 'node:crypto';
import type { CalendarDate } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { TermsAnswers } from '../terms/pack.js';

/**
 * The offer (Recruiting PRD §18, REC-023).
 *
 * Versioned: a counter-offer is a new version and the earlier one is kept,
 * marked superseded. Checked before anyone sees it — the terms by the pack,
 * the pay against the band, the advertised range and the budget — and
 * accepted against the hash of the version the candidate read.
 */

export type OfferState =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'sent'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'withdrawn';

export interface Pay {
  readonly baseMinor: number;
  readonly currency: string;
  readonly frequency: 'year' | 'month' | 'hour';
  readonly variableTargetMinor: number;
  readonly signOnMinor: number;
  readonly relocationMinor: number;
  /** A description and a number of units; never priced by Kithena. */
  readonly equity: { readonly description: string; readonly units: number } | null;
}

export interface OfferVersion {
  readonly version: number;
  readonly terms: TermsAnswers;
  readonly pay: Pay;
  readonly benefitIds: readonly string[];
  /** Benefits the recruiter wrote in for this offer alone, in their words; no catalogue entry, no value. */
  readonly extraBenefits?: readonly string[];
  readonly startDate: CalendarDate;
  readonly expiresOn: CalendarDate;
  readonly letterTemplateId: string | null;
  readonly supersededAt: string | null;
}

export interface Acceptance {
  readonly version: number;
  readonly at: string;
  readonly ip: string;
  readonly versionHash: string;
}

export interface Offer {
  readonly id: string;
  readonly applicationId: string;
  readonly state: OfferState;
  readonly versions: readonly OfferVersion[];
  readonly acceptance: Acceptance | null;
  readonly declineReason: string | null;
  /** Approval needed for these reasons (PRD §18.3); empty when the chain is skipped. */
  readonly approvalReasons: readonly string[];
}

export const latest = (offer: Offer): OfferVersion => {
  const version = offer.versions.at(-1);
  if (version === undefined) throw new Error(`Offer ${offer.id} has no version`);
  return version;
};

/** The hash a candidate's acceptance is recorded against: the version's content, in a stable order. */
export function versionHash(version: OfferVersion): string {
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value !== null && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .filter(([key]) => key !== 'supersededAt')
              .toSorted(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, stable(v)]),
          )
        : value;
  return createHash('sha256')
    .update(JSON.stringify(stable(version)))
    .digest('hex');
}

/* ------------------------------------------------------------- checks -- */

export interface OfferFacts {
  readonly today: CalendarDate;
  /** The grade's band (People's or Recruiting's), yearly minor units. */
  readonly band: {
    readonly minMinor: number;
    readonly maxMinor: number;
    readonly currency: string;
  } | null;
  /** The range the ad showed, when it showed one. */
  readonly advertised: {
    readonly minMinor: number;
    readonly maxMinor: number;
    readonly currency: string;
  } | null;
  /** Directive (EU) 2023/970 applies to the job's place. */
  readonly payTransparency: boolean;
  /** The requisition's budget's upper end. */
  readonly budgetMaxMinor: number | null;
  /** The entity's currency. */
  readonly currency: string;
  readonly outsideBandReason: string | null;
}

export interface OfferCheck {
  readonly code: string;
  readonly severity: 'error' | 'approval';
  readonly message: string;
}

/** Yearly base, for comparing with a band or a range. */
export const yearlyBase = (pay: Pay, weeklyMinutes: number): number =>
  pay.frequency === 'year'
    ? pay.baseMinor
    : pay.frequency === 'month'
      ? pay.baseMinor * 12
      : Math.ceil((pay.baseMinor * weeklyMinutes * 52) / 60);

export function offerChecks(version: OfferVersion, facts: OfferFacts): OfferCheck[] {
  const out: OfferCheck[] = [];
  const base = yearlyBase(version.pay, version.terms.weeklyMinutes ?? 0);
  if (version.pay.currency !== facts.currency) {
    out.push({
      code: 'currency',
      severity: 'error',
      message: `Pay is in the entity’s currency, ${facts.currency}`,
    });
  }
  if (version.startDate < facts.today)
    out.push({ code: 'start_past', severity: 'error', message: 'The start date has passed' });
  if (version.expiresOn < facts.today)
    out.push({ code: 'expiry_past', severity: 'error', message: 'The offer’s expiry has passed' });
  if (version.expiresOn > version.startDate) {
    out.push({
      code: 'expiry_after_start',
      severity: 'error',
      message: 'The offer expires after the start date',
    });
  }
  if (facts.band !== null && (base < facts.band.minMinor || base > facts.band.maxMinor)) {
    out.push(
      facts.outsideBandReason === null || facts.outsideBandReason.trim() === ''
        ? {
            code: 'outside_band_reason',
            severity: 'error',
            message: 'Outside the band: give a reason',
          }
        : { code: 'outside_band', severity: 'approval', message: 'Outside the band for the grade' },
    );
  }
  if (facts.payTransparency && facts.advertised !== null && base < facts.advertised.minMinor) {
    out.push({
      code: 'below_advertised',
      severity: 'error',
      message: 'Below the range the ad gave (Directive (EU) 2023/970)',
    });
  }
  if (facts.budgetMaxMinor !== null && base > facts.budgetMaxMinor) {
    out.push({
      code: 'above_budget',
      severity: 'approval',
      message: 'Above the requisition’s budget',
    });
  }
  for (const [label, amount] of [
    ['base', version.pay.baseMinor],
    ['variable', version.pay.variableTargetMinor],
    ['sign-on bonus', version.pay.signOnMinor],
    ['relocation', version.pay.relocationMinor],
  ] as const) {
    if (!Number.isInteger(amount) || amount < 0)
      out.push({
        code: 'money',
        severity: 'error',
        message: `The ${label} is a whole, non-negative amount`,
      });
  }
  if (version.pay.baseMinor <= 0)
    out.push({ code: 'base_required', severity: 'error', message: 'Give the base pay' });
  return out;
}

/* ---------------------------------------------------------- lifecycle -- */

export function draftOffer(
  id: string,
  applicationId: string,
  first: Omit<OfferVersion, 'version' | 'supersededAt'>,
): Offer {
  return {
    id,
    applicationId,
    state: 'draft',
    versions: [{ ...first, version: 1, supersededAt: null }],
    acceptance: null,
    declineReason: null,
    approvalReasons: [],
  };
}

/** Edit the draft version in place; a sent version is never edited, only revised. */
export function editDraft(
  offer: Offer,
  next: Omit<OfferVersion, 'version' | 'supersededAt'>,
): Result<Offer> {
  if (offer.state !== 'draft')
    return err(failure('NOT_DRAFT', 'Only a draft is edited; revise a sent offer'));
  const current = latest(offer);
  return ok({
    ...offer,
    versions: [
      ...offer.versions.slice(0, -1),
      { ...next, version: current.version, supersededAt: null },
    ],
  });
}

/**
 * Send for approval, or straight to approved when no chain applies. The
 * terms must have validated (`termsErrors` empty) and no check may be an
 * error: there is no override.
 */
export function submitOffer(
  offer: Offer,
  checks: readonly OfferCheck[],
  termsErrors: number,
  chainApplies: boolean,
): Result<Offer> {
  if (offer.state !== 'draft') return err(failure('NOT_DRAFT', 'Only a draft is submitted'));
  if (termsErrors > 0) return err(failure('TERMS', 'The terms have errors to fix'));
  const errors = checks.filter((c) => c.severity === 'error');
  if (errors.length > 0) return err(failure('CHECKS', errors.map((c) => c.message).join('; ')));
  const reasons = checks.filter((c) => c.severity === 'approval').map((c) => c.code);
  return ok({
    ...offer,
    state: chainApplies || reasons.length > 0 ? 'pending_approval' : 'approved',
    approvalReasons: reasons,
  });
}

export function approvalOutcome(offer: Offer, outcome: 'approved' | 'rejected'): Result<Offer> {
  if (offer.state !== 'pending_approval')
    return err(failure('NOT_PENDING', 'This offer is not awaiting approval'));
  return ok({ ...offer, state: outcome === 'approved' ? 'approved' : 'draft' });
}

export function sendOffer(
  offer: Offer,
  today: CalendarDate,
  worksCouncilCleared: boolean,
): Result<Offer> {
  if (offer.state !== 'approved')
    return err(failure('NOT_APPROVED', 'Only an approved offer is sent'));
  if (!worksCouncilCleared)
    return err(failure('WORKS_COUNCIL', 'The works council has not consented (§ 99 BetrVG)'));
  if (latest(offer).expiresOn < today)
    return err(failure('EXPIRED', 'The expiry has passed; revise the offer'));
  return ok({ ...offer, state: 'sent' });
}

export function acceptOffer(
  offer: Offer,
  hash: string,
  at: string,
  ip: string,
  today: CalendarDate,
): Result<Offer> {
  if (offer.state !== 'sent') return err(failure('NOT_SENT', 'This offer is not open to accept'));
  const version = latest(offer);
  if (version.expiresOn < today) return err(failure('EXPIRED', 'This offer has expired'));
  if (versionHash(version) !== hash)
    return err(failure('CHANGED', 'The offer changed since it was opened; read it again'));
  return ok({
    ...offer,
    state: 'accepted',
    acceptance: { version: version.version, at, ip, versionHash: hash },
  });
}

/** Declining says why (the recruiter reads it, and may come back with new terms). */
export function declineOffer(offer: Offer, reason: string | null): Result<Offer> {
  if (offer.state !== 'sent') return err(failure('NOT_SENT', 'This offer is not open to decline'));
  const why = reason?.trim() ?? '';
  if (why === '') return err(failure('REASON_REQUIRED', 'Say why you are declining'));
  return ok({ ...offer, state: 'declined', declineReason: why });
}

export function expireOffer(offer: Offer, today: CalendarDate): Offer {
  return offer.state === 'sent' && latest(offer).expiresOn < today
    ? { ...offer, state: 'expired' }
    : offer;
}

export function withdrawOffer(offer: Offer): Result<Offer> {
  if (offer.state === 'accepted' || offer.state === 'withdrawn')
    return err(failure('CLOSED', `An ${offer.state} offer cannot be withdrawn here`));
  return ok({ ...offer, state: 'withdrawn' });
}

/** A counter-offer (PRD §18.4): a new draft version; the one before is superseded and kept. */
export function reviseOffer(
  offer: Offer,
  at: string,
  next: Omit<OfferVersion, 'version' | 'supersededAt'>,
): Result<Offer> {
  if (!['sent', 'declined', 'expired', 'approved'].includes(offer.state)) {
    return err(failure('NOT_REVISABLE', `A ${offer.state.replace('_', ' ')} offer is not revised`));
  }
  const current = latest(offer);
  return ok({
    ...offer,
    state: 'draft',
    declineReason: null,
    approvalReasons: [],
    versions: [
      ...offer.versions.slice(0, -1),
      { ...current, supersededAt: at },
      { ...next, version: current.version + 1, supersededAt: null },
    ],
  });
}
