import * as z from 'zod';

import { asFinancial, asInternal, asPublic, policy } from '../classification.js';
import { CalendarDate, Instant } from '../primitives.js';

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
} as const;

export const RecruitingApprovalDetail = z.object({
  /** What is approved, as Recruiting names it: "Senior Backend Engineer, 2 openings". */
  subject: z.string().max(240).register(policy, asInternal()),
  step: z.int().min(1).register(policy, asPublic()),
  steps: z.int().min(1).register(policy, asPublic()),
  /** Why approval is needed: "Above budget", "Outside the band". */
  reasons: z.array(z.string().max(120).register(policy, asPublic())),
  /** What changed since the last approval (PRD §7.2). */
  changes: z.array(
    z.object({
      field: z.string().max(40).register(policy, asPublic()),
      from: z.string().max(120).register(policy, asFinancial()),
      to: z.string().max(120).register(policy, asFinancial()),
    }),
  ),
});
export type RecruitingApprovalDetail = z.infer<typeof RecruitingApprovalDetail>;

export const RecruitingScorecardDetail = z.object({
  candidate: z.string().max(200).register(policy, asInternal('identity')),
  job: z.string().max(200).register(policy, asInternal()),
  interview: z.string().max(120).register(policy, asInternal()),
  endedAt: Instant,
  dueOn: CalendarDate,
});
export type RecruitingScorecardDetail = z.infer<typeof RecruitingScorecardDetail>;
