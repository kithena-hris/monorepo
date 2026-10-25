import * as z from 'zod';

import { asContact, asIdentity, asInternal, asPublic, policy } from '../classification.js';
import { defineEvent } from '../event.js';
import { activityRecorded } from './activity.js';
import { CalendarDate, Instant, LegalEntityId, Money } from '../primitives.js';
import {
  ApplicationId,
  ApplicationSource,
  CandidateContact,
  CandidateId,
  ConditionKind,
  ConditionState,
  InterviewId,
  JobId,
  OfferId,
  PrehireCancelReason,
  PublicationTarget,
  Recommendation,
  RejectionReasonKey,
  RequisitionId,
  StageCategory,
  StageId,
} from '../recruiting/primitives.js';
import { ResolvedTerms } from '../recruiting/terms.js';

/**
 * Recruiting's events (Recruiting PRD §27).
 *
 * No payload carries a CV, a note, a message body, an answer or a score
 * explanation: `recruiting.test.ts` walks every one. The single exception is
 * `recruiting.candidate.hired`, which hands the hire over and so carries the
 * candidate's name and address, the terms and the pay — what People needs to
 * create the `pre_hire` without asking Recruiting anything.
 */

const memberId = () => z.uuid().register(policy, asPublic());
const ref = () => z.uuid().register(policy, asPublic());

export const RequisitionSubmitted = defineEvent(
  'recruiting.requisition.submitted',
  1,
  z.object({
    requisitionId: RequisitionId,
    openings: z.int().positive().register(policy, asInternal()),
    orgUnitId: ref().nullable(),
    legalEntityId: LegalEntityId.nullable(),
    budgetFrom: Money.nullable(),
    budgetTo: Money.nullable(),
  }),
);

export const RequisitionDecided = defineEvent(
  'recruiting.requisition.decided',
  1,
  z.object({
    requisitionId: RequisitionId,
    decision: z.enum(['approved', 'rejected']).register(policy, asInternal()),
    by: memberId(),
  }),
);

const jobState = (name: string) =>
  defineEvent(name, 1, z.object({ jobId: JobId, requisitionIds: z.array(RequisitionId) }));

export const JobOpened = jobState('recruiting.job.opened');
export const JobClosed = jobState('recruiting.job.closed');
export const JobFilled = jobState('recruiting.job.filled');

export const JobPublished = defineEvent(
  'recruiting.job.published',
  1,
  z.object({
    jobId: JobId,
    target: PublicationTarget,
    url: z.url().nullable().register(policy, asPublic()),
  }),
);

export const JobUnpublished = defineEvent(
  'recruiting.job.unpublished',
  1,
  z.object({ jobId: JobId, target: PublicationTarget }),
);

export const ApplicationReceived = defineEvent(
  'recruiting.application.received',
  1,
  z.object({
    applicationId: ApplicationId,
    candidateId: CandidateId,
    jobId: JobId,
    source: ApplicationSource,
    knockedOut: z.boolean().register(policy, asInternal()),
  }),
);

export const ApplicationMoved = defineEvent(
  'recruiting.application.moved',
  1,
  z.object({
    applicationId: ApplicationId,
    jobId: JobId,
    from: StageId,
    to: StageId,
    category: StageCategory,
    by: memberId(),
    /** The move this corrects; a correction is never an overwrite (repo rule). */
    supersedes: ref().nullable(),
  }),
);

export const ApplicationRejected = defineEvent(
  'recruiting.application.rejected',
  1,
  z.object({
    applicationId: ApplicationId,
    jobId: JobId,
    reasonKey: RejectionReasonKey,
    by: memberId(),
  }),
);

export const ApplicationWithdrawn = defineEvent(
  'recruiting.application.withdrawn',
  1,
  z.object({ applicationId: ApplicationId, jobId: JobId }),
);

const interviewState = (name: string) =>
  defineEvent(
    name,
    1,
    z.object({
      interviewId: InterviewId,
      applicationId: ApplicationId,
      interviewerIds: z.array(memberId()),
      startsAt: Instant,
    }),
  );

export const InterviewScheduled = interviewState('recruiting.interview.scheduled');
export const InterviewCompleted = interviewState('recruiting.interview.completed');
export const InterviewCancelled = interviewState('recruiting.interview.cancelled');

export const ScorecardSubmitted = defineEvent(
  'recruiting.scorecard.submitted',
  1,
  z.object({
    interviewId: InterviewId,
    applicationId: ApplicationId,
    interviewerId: memberId(),
    recommendation: Recommendation,
  }),
);

const offerState = (name: string) =>
  defineEvent(
    name,
    1,
    z.object({
      offerId: OfferId,
      applicationId: ApplicationId,
      version: z.int().positive().register(policy, asInternal()),
    }),
  );

export const OfferApproved = offerState('recruiting.offer.approved');
export const OfferSent = offerState('recruiting.offer.sent');
export const OfferAccepted = offerState('recruiting.offer.accepted');
export const OfferDeclined = offerState('recruiting.offer.declined');
export const OfferWithdrawn = offerState('recruiting.offer.withdrawn');

/**
 * The hand-over (PRD §21.3, §21.4): People creates the `pre_hire` from it,
 * Onboarding starts a plan, a webhook carries it to any other HRIS.
 */
export const CandidateHired = defineEvent(
  'recruiting.candidate.hired',
  1,
  z.object({
    candidateId: CandidateId,
    applicationId: ApplicationId,
    jobId: JobId,
    offerId: OfferId,
    offerVersion: z.int().positive().register(policy, asInternal()),
    candidate: CandidateContact,
    terms: ResolvedTerms,
    pay: z.object({
      base: Money,
      frequency: z.enum(['year', 'month', 'hour']).register(policy, asInternal()),
    }),
    benefits: z.array(
      z.object({
        /** The catalogue's id: a library one (`lib:…`), a statutory one (`statutory:…`) or a company's. */
        benefitId: z.string().min(1).max(160).register(policy, asPublic()),
        statutory: z.boolean().register(policy, asPublic()),
      }),
    ),
    startDate: CalendarDate,
    managerId: memberId().nullable(),
    orgUnitId: ref().nullable(),
    locationId: ref().nullable(),
    legalEntityId: LegalEntityId,
    conditions: z.array(z.object({ kind: ConditionKind, state: ConditionState })),
    /** The signature they signed the contract with, for their record; null when signed elsewhere. */
    /** As its JSON text (`SignatureMark`), the form People keeps a signature in. */
    signature: z.string().max(50_000).nullable().default(null).register(policy, asIdentity()),
  }),
);

export const PrehireConditionsMet = defineEvent(
  'recruiting.prehire.conditions_met',
  1,
  z.object({ candidateId: CandidateId, applicationId: ApplicationId }),
);

export const PrehireCancelled = defineEvent(
  'recruiting.prehire.cancelled',
  1,
  z.object({
    candidateId: CandidateId,
    applicationId: ApplicationId,
    reasonKey: PrehireCancelReason,
    /** The work email the hire was created under, which is how People finds the record to discard (§21.4). */
    email: z.email().nullable().register(policy, asContact()),
  }),
);

export const CandidateDeleted = defineEvent(
  'recruiting.candidate.deleted',
  1,
  z.object({ candidateId: CandidateId }),
);

/** Every act in Recruiting, in words, for the company's activity log (`docs/audit.md`). */
export const RecruitingActivityRecorded = activityRecorded('recruiting');

export const recruitingEvents = [
  RecruitingActivityRecorded,
  RequisitionSubmitted,
  RequisitionDecided,
  JobOpened,
  JobClosed,
  JobFilled,
  JobPublished,
  JobUnpublished,
  ApplicationReceived,
  ApplicationMoved,
  ApplicationRejected,
  ApplicationWithdrawn,
  InterviewScheduled,
  InterviewCompleted,
  InterviewCancelled,
  ScorecardSubmitted,
  OfferApproved,
  OfferSent,
  OfferAccepted,
  OfferDeclined,
  OfferWithdrawn,
  CandidateHired,
  PrehireConditionsMet,
  PrehireCancelled,
  CandidateDeleted,
] as const;
