import * as z from 'zod';

import { asFinancial, asInternal, asPublic, policy } from '../classification.js';
import { CalendarDate, Instant, Money } from '../primitives.js';

/**
 * Recruiting's answer to the Inbox (Recruiting PRD §5.3, REC-014): the kinds
 * it sends and what each detail pane is drawn from. Items themselves are
 * `InboxItem`s; these name and shape Recruiting's part.
 */

export const RECRUITING_INBOX_KINDS = {
  /** Approve a requisition: a task for each approver of the step waiting. */
  requisitionApproval: 'recruiting.requisition-approval',
  /** Approve an offer. */
  offerApproval: 'recruiting.offer-approval',
  /** Submit a scorecard, due 24 hours after the interview. */
  scorecard: 'recruiting.scorecard',
  /** New applicants on a job you hire for: an update, bundled per job. */
  newApplicants: 'recruiting.new-applicants',
  /** An interview you are on, today. */
  interviewToday: 'recruiting.interview-today',
  /** A candidate replied to a thread you own. */
  reply: 'recruiting.reply',
  /** A pre-hire condition is open on the start date. */
  conditionOpen: 'recruiting.condition-open',
  /** A works council asked to consent to a hire (§ 99 BetrVG). */
  worksCouncil: 'recruiting.works-council',
  /** A candidate gave times through a scheduling link: choose one, or ask for more. */
  chooseTime: 'recruiting.choose-time',
  /** A candidate accepted: create the contract and send it to sign. */
  createContract: 'recruiting.create-contract',
} as const;

const ApprovalSteps = {
  step: z.int().min(1).register(policy, asPublic()),
  steps: z.int().min(1).register(policy, asPublic()),
  /** What changed since the last approval (PRD §7.2). */
  changes: z.array(
    z.object({
      field: z.string().max(40).register(policy, asPublic()),
      from: z.string().max(120).register(policy, asFinancial()),
      to: z.string().max(120).register(policy, asFinancial()),
    }),
  ),
};

/**
 * What an approver decides on, to approve or reject it in the Inbox
 * (`recruiting.requisition-approval`, `recruiting.offer-approval`): the
 * figures as they are, for the reader's language to format.
 */
export const RecruitingApprovalDetail = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('requisition'),
    requisitionId: z.uuid().register(policy, asPublic()),
    title: z.string().max(240).register(policy, asInternal()),
    openings: z.int().min(1).register(policy, asPublic()),
    targetStart: CalendarDate.nullable(),
    budget: z.object({ from: Money, to: Money }).nullable(),
    justification: z.string().max(4000).register(policy, asInternal()),
    ...ApprovalSteps,
  }),
  z.object({
    kind: z.literal('offer'),
    offerId: z.uuid().register(policy, asPublic()),
    candidate: z.string().max(200).register(policy, asInternal('identity')),
    job: z.string().max(200).register(policy, asInternal()),
    base: Money,
    frequency: z.enum(['year', 'month', 'hour']).register(policy, asPublic()),
    startDate: CalendarDate,
    variableTarget: Money.nullable(),
    signOn: Money.nullable(),
    ...ApprovalSteps,
  }),
]);
export type RecruitingApprovalDetail = z.infer<typeof RecruitingApprovalDetail>;

/** A scorecard owed, to fill in and submit from the Inbox (`recruiting.scorecard`). */
export const RecruitingScorecardDetail = z.object({
  interviewId: z.uuid().register(policy, asPublic()),
  candidate: z.string().max(200).register(policy, asInternal('identity')),
  job: z.string().max(200).register(policy, asInternal()),
  interview: z.string().max(120).register(policy, asInternal()),
  /** Submitted only once it has begun; before that, a draft. */
  startsAt: Instant,
  endedAt: Instant,
  dueOn: CalendarDate,
  /** What to rate, 1 to 4; none, only the overall recommendation. */
  competencies: z
    .array(
      z.object({
        key: z.string().max(60).register(policy, asPublic()),
        name: z.string().max(120).register(policy, asInternal()),
        description: z.string().max(1000).register(policy, asInternal()),
      }),
    )
    .max(30),
});
export type RecruitingScorecardDetail = z.infer<typeof RecruitingScorecardDetail>;

/** The times a candidate gave, to book one from the Inbox (`recruiting.choose-time`). */
export const RecruitingChooseTimeDetail = z.object({
  applicationId: z.uuid().register(policy, asPublic()),
  askId: z.uuid().register(policy, asPublic()),
  candidate: z.string().max(200).register(policy, asInternal('identity')),
  job: z.string().max(200).register(policy, asInternal()),
  interview: z.string().max(120).register(policy, asInternal()),
  minutes: z.int().min(1).register(policy, asPublic()),
  times: z.array(Instant),
  /** Where it will happen and the agenda, as chosen when the link was sent. */
  where: z.string().max(500).nullable().register(policy, asInternal()),
  agenda: z.string().max(4000).nullable().register(policy, asInternal()),
});
export type RecruitingChooseTimeDetail = z.infer<typeof RecruitingChooseTimeDetail>;
