import * as z from 'zod';

import {
  asContact,
  asFreeText,
  asIdentity,
  asInternal,
  asPublic,
  policy,
} from '../classification.js';
import { PostalAddress } from '../address.js';
import { keySchema } from '../people/primitives.js';

/**
 * The vocabulary Recruiting's contracts are written in (Recruiting PRD §9,
 * §12, §16, §19, §21). Here rather than in `events/recruiting.ts` for the
 * reason Documents gives: the terms, the public shapes and the views need it
 * too, and an event file importing them importing the event file is a cycle.
 */

export const RequisitionId = z.uuid().brand<'RequisitionId'>().register(policy, asPublic());
export type RequisitionId = z.infer<typeof RequisitionId>;
export const JobId = z.uuid().brand<'JobId'>().register(policy, asPublic());
export type JobId = z.infer<typeof JobId>;
export const CandidateId = z.uuid().brand<'CandidateId'>().register(policy, asPublic());
export type CandidateId = z.infer<typeof CandidateId>;
export const ApplicationId = z.uuid().brand<'ApplicationId'>().register(policy, asPublic());
export type ApplicationId = z.infer<typeof ApplicationId>;
export const StageId = z.uuid().brand<'StageId'>().register(policy, asPublic());
export type StageId = z.infer<typeof StageId>;
export const InterviewId = z.uuid().brand<'InterviewId'>().register(policy, asPublic());
export type InterviewId = z.infer<typeof InterviewId>;
export const OfferId = z.uuid().brand<'OfferId'>().register(policy, asPublic());
export type OfferId = z.infer<typeof OfferId>;
export const PoolId = z.uuid().brand<'PoolId'>().register(policy, asPublic());
export type PoolId = z.infer<typeof PoolId>;
export const AgencyId = z.uuid().brand<'AgencyId'>().register(policy, asPublic());
export type AgencyId = z.infer<typeof AgencyId>;
export const BenefitId = z.uuid().brand<'BenefitId'>().register(policy, asPublic());
export type BenefitId = z.infer<typeof BenefitId>;

/** The countries a terms pack exists for (PRD §19.1): People's launch set. */
export const LaunchCountry = z.enum(['DE', 'ES', 'GB', 'IN', 'US']).register(policy, asPublic());
export type LaunchCountry = z.infer<typeof LaunchCountry>;

/**
 * What analytics reads from a stage, whatever the hiring team calls it
 * (PRD §12.1). `works_council` is the § 99 BetrVG stage a German entity with
 * a works council gains before `offer` (§19.9): its own category because an
 * offer may not be sent before it ends, and that rule reads the category.
 * `contract` sits between the accepted offer and the hire: the contract is
 * prepared, checked and signed there, and its signature is the hire.
 */
export const StageCategory = z
  .enum([
    'applied',
    'screening',
    'interview',
    'assessment',
    'works_council',
    'offer',
    'contract',
    'hired',
  ])
  .register(policy, asPublic());
export type StageCategory = z.infer<typeof StageCategory>;

/** Where an application ended when it did not end in a hire. */
export const ApplicationOutcome = z
  .enum(['active', 'hired', 'rejected', 'withdrawn'])
  .register(policy, asInternal());
export type ApplicationOutcome = z.infer<typeof ApplicationOutcome>;

/** Where a job is advertised (PRD §9.1). */
export const PublicationTarget = z
  .enum([
    'careers_page',
    'kithena_jobs',
    'google_for_jobs',
    'xml_feed',
    'internal_board',
    'share_link',
    'indeed',
    'glassdoor',
    'linkedin',
    'agency',
  ])
  .register(policy, asPublic());
export type PublicationTarget = z.infer<typeof PublicationTarget>;

export const TargetState = z
  .enum(['pending', 'live', 'paused', 'expired', 'failed'])
  .register(policy, asPublic());
export type TargetState = z.infer<typeof TargetState>;

/** A share link's channel: the tracked link a recruiter posts by hand (§9.1). */
export const ShareChannel = keySchema('share channel').register(policy, asPublic());

/**
 * Where an application came from (PRD §9.2). Fixed when the application is
 * made; corrected only by a typed correction with a reason.
 */
export const ApplicationSource = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('target'), target: PublicationTarget }),
    z.object({ kind: z.literal('share_link'), channel: ShareChannel }),
    z.object({
      kind: z.literal('referral'),
      referrerPersonId: z.uuid().register(policy, asPublic()),
    }),
    z.object({ kind: z.literal('agency'), agencyId: AgencyId }),
    z.object({ kind: z.literal('sourced') }),
    z.object({ kind: z.literal('recruiter') }),
  ])
  .register(policy, asInternal());
export type ApplicationSource = z.infer<typeof ApplicationSource>;

/**
 * A rejection's reason (PRD §12.4): the shipped keys, or a tenant's own key.
 * A key, never free text, so an event can carry it.
 */
export const REJECTION_REASONS = [
  'not_qualified',
  'better_candidate',
  'withdrew_interest',
  'no_show',
  'salary',
  'location',
  'position_closed',
  'knockout',
] as const;
export const RejectionReasonKey = keySchema('rejection reason').register(policy, asInternal());
export type RejectionReasonKey = z.infer<typeof RejectionReasonKey>;

/** How a job is done (PRD §8.1, §19.2 step 10); People's `work_model` values. */
export const WorkMode = z.enum(['onsite', 'hybrid', 'remote']).register(policy, asPublic());
export type WorkMode = z.infer<typeof WorkMode>;

/** A scorecard's overall recommendation (PRD §16.2): four points, no midpoint. */
export const Recommendation = z
  .enum(['strong_no', 'no', 'yes', 'strong_yes'])
  .register(policy, asInternal());
export type Recommendation = z.infer<typeof Recommendation>;

/** A rating on the 1–4 scale (PRD §16.2). Stored as an integer; averages are the domain's. */
export const Rating = z.int().min(1).max(4).register(policy, asInternal());
export type Rating = z.infer<typeof Rating>;

/** What a candidate agreed to, each separately (PRD §10.4). */
export const ConsentPurpose = z
  .enum(['application', 'talent_pool', 'nyc_aedt_notice'])
  .register(policy, asInternal());
export type ConsentPurpose = z.infer<typeof ConsentPurpose>;

/** A condition a pre-hire must meet before the start (PRD §21.3). */
export const ConditionKind = z
  .enum([
    'right_to_work',
    'background_check',
    'references',
    'qualification',
    'work_permit',
    'works_council',
  ])
  .register(policy, asPublic());
export type ConditionKind = z.infer<typeof ConditionKind>;

export const ConditionState = z
  .enum(['open', 'met', 'waived', 'failed'])
  .register(policy, asInternal());
export type ConditionState = z.infer<typeof ConditionState>;

/** Why a pre-hire fell through before the start (PRD §21.3). */
export const PrehireCancelReason = z
  .enum(['reneged', 'no_show', 'failed_condition', 'offer_withdrawn', 'other'])
  .register(policy, asInternal());
export type PrehireCancelReason = z.infer<typeof PrehireCancelReason>;

/** The candidate's own name and address, on the one event that hands a hire over. */
export const CandidateContact = z.object({
  givenName: z.string().min(1).max(200).register(policy, asIdentity()),
  familyName: z.string().max(200).register(policy, asIdentity()),
  email: z.email().register(policy, asContact()),
  phone: z.string().max(40).nullable().register(policy, asContact()),
});
export type CandidateContact = z.infer<typeof CandidateContact>;

/**
 * What only the candidate knows and their record needs, asked after they
 * accept the offer and before the contract (Recruiting's details request):
 * stated in the contract for them to check, and handed to People with the
 * hire. Each may be left out; the contract and the record say what was given.
 */
export const CandidateDetails = z.object({
  preferredName: z.string().trim().max(100).nullable().register(policy, asIdentity()),
  dateOfBirth: z.iso.date().nullable().register(policy, asIdentity()),
  personalEmail: z.email().max(254).nullable().register(policy, asContact()),
  /** International, `+` and the country code first: what People keeps. */
  mobilePhone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/u, 'an international number, +country code first')
    .nullable()
    .register(policy, asContact()),
  homeAddress: PostalAddress.nullable(),
});
export type CandidateDetails = z.infer<typeof CandidateDetails>;

/** A note's or a message's text: never on an event, here for the views. */
export const RecruitingText = z.string().max(20_000).register(policy, asFreeText());
