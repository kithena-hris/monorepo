import * as z from 'zod';

import { asPublic, policy } from '../classification.js';

/**
 * Performance's vocabulary (Performance PRD §6, PRF-010): its ids, a cycle's
 * and a review's states, and the activity kinds a cycle is made of.
 */

export const CycleId = z.uuid().brand<'CycleId'>().register(policy, asPublic());
export type CycleId = z.infer<typeof CycleId>;
export const ReviewId = z.uuid().brand<'ReviewId'>().register(policy, asPublic());
export type ReviewId = z.infer<typeof ReviewId>;
export const FormTemplateId = z.uuid().brand<'FormTemplateId'>().register(policy, asPublic());
export type FormTemplateId = z.infer<typeof FormTemplateId>;
export const GoalId = z.uuid().brand<'GoalId'>().register(policy, asPublic());
export type GoalId = z.infer<typeof GoalId>;
export const FeedbackId = z.uuid().brand<'FeedbackId'>().register(policy, asPublic());
export type FeedbackId = z.infer<typeof FeedbackId>;
export const LearningItemId = z.uuid().brand<'LearningItemId'>().register(policy, asPublic());
export type LearningItemId = z.infer<typeof LearningItemId>;
export const CalibrationSessionId = z
  .uuid()
  .brand<'CalibrationSessionId'>()
  .register(policy, asPublic());
export type CalibrationSessionId = z.infer<typeof CalibrationSessionId>;

/** §7, §8.7. `launch_failed` keeps what was created; a retry continues from it. */
export const CycleState = z
  .enum([
    'draft',
    'scheduling',
    'scheduled',
    'launching',
    'launch_failed',
    'in_progress',
    'closing',
    'closed',
    'archived',
  ])
  .register(policy, asPublic());
export type CycleState = z.infer<typeof CycleState>;

/**
 * §10.1. `in_review` is calibration's hold: a submitted, scored review while a
 * session compares it. Detaching (§10.7) is a flag on a review, not a status.
 */
export const ReviewStatus = z
  .enum([
    'not_started',
    'in_progress',
    'locked',
    'unlock_requested',
    'unlocked',
    'in_review',
    'abandoned',
    'withdrawn',
    'completed',
    'cancelled',
  ])
  .register(policy, asPublic());
export type ReviewStatus = z.infer<typeof ReviewStatus>;

/** §9: each is an implementation of the domain's `ActivityKind` port. */
export const ActivityKind = z
  .enum(['self', 'manager', 'peer', 'upward', 'skip', 'goals'])
  .register(policy, asPublic());
export type ActivityKind = z.infer<typeof ActivityKind>;

export const TemplateVersionState = z
  .enum(['draft', 'publishing', 'published', 'superseded', 'archived'])
  .register(policy, asPublic());
export type TemplateVersionState = z.infer<typeof TemplateVersionState>;

/** Performance's Inbox item kinds (§5.3, PRF-012). */
export const PERFORMANCE_INBOX_KINDS = {
  review: 'performance.review',
  nominate: 'performance.nominate',
  approveNominations: 'performance.approve-nominations',
  unlock: 'performance.unlock',
  feedbackRequest: 'performance.feedback-request',
  learning: 'performance.learning',
  checkIn: 'performance.check-in',
  released: 'performance.released',
  /** A manager review its writer no longer writes: the subject reports to someone else (§8.8). */
  managerChanged: 'performance.manager-changed',
} as const;
