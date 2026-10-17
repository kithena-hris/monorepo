import * as z from 'zod';

import { asInternal, asPublic, policy } from '../classification.js';
import { defineEvent } from '../event.js';
import { activityRecorded } from './activity.js';
import { CalendarDate } from '../primitives.js';
import {
  ActivityKind,
  CalibrationSessionId,
  CycleId,
  CycleState,
  FeedbackId,
  FormTemplateId,
  GoalId,
  LearningItemId,
  ReviewId,
  ReviewStatus,
} from '../performance/primitives.js';

/**
 * Performance's events (Performance PRD §25, PRF-011). Ids and states, never
 * an answer, a comment, a note or a name: what a review says stays in
 * Performance, and a consumer that needs more asks through the API, where the
 * reader is checked.
 *
 * `performance.rating.finalized` is Compensation's: one per person when a
 * score is final, `effectiveFrom` the end of the review period, and
 * `supersedes` when calibration or a correction replaces an earlier one.
 */

const personId = () => z.uuid().register(policy, asPublic());

export const CycleStateChanged = defineEvent(
  'performance.cycle.state_changed',
  1,
  z.object({
    cycleId: CycleId,
    from: CycleState.nullable(),
    to: CycleState,
    reviews: z.int().nonnegative().register(policy, asPublic()),
  }),
);

export const ReviewStatusChanged = defineEvent(
  'performance.review.status_changed',
  1,
  z.object({
    reviewId: ReviewId,
    cycleId: CycleId.nullable(),
    kind: ActivityKind,
    subjectId: personId(),
    from: ReviewStatus,
    to: ReviewStatus,
  }),
);

export const ReviewReleased = defineEvent(
  'performance.review.released',
  1,
  z.object({ reviewId: ReviewId, cycleId: CycleId, subjectId: personId() }),
);

export const TemplatePublished = defineEvent(
  'performance.template.published',
  1,
  z.object({
    templateId: FormTemplateId,
    version: z.int().min(1).register(policy, asPublic()),
  }),
);

export const FeedbackGiven = defineEvent(
  'performance.feedback.given',
  1,
  z.object({
    feedbackId: FeedbackId,
    to: personId(),
    praise: z.boolean().register(policy, asPublic()),
  }),
);

export const GoalCheckedIn = defineEvent(
  'performance.goal.checked_in',
  1,
  z.object({
    goalId: GoalId,
    owner: personId(),
    progress: z.int().min(0).max(100).register(policy, asInternal()),
    confidence: z.enum(['on_track', 'at_risk', 'off_track']).register(policy, asInternal()),
  }),
);

export const LearningCompleted = defineEvent(
  'performance.learning.completed',
  1,
  z.object({ itemId: LearningItemId, personId: personId() }),
);

export const RatingFinalized = defineEvent(
  'performance.rating.finalized',
  1,
  z.object({
    cycleId: CycleId,
    sessionId: CalibrationSessionId.nullable(),
    personId: personId(),
    /** The score in hundredths on the company scale: 380 is 3.80. Never a float. */
    scoreHundredths: z.int().register(policy, asInternal()),
    scaleMin: z.int().register(policy, asPublic()),
    scaleMax: z.int().register(policy, asPublic()),
    periodTo: CalendarDate,
    /** The event this one replaces, after a correction. */
    supersedes: z.uuid().nullable().register(policy, asPublic()),
  }),
);

/** Every act in Performance, in words, for the company's activity log (`docs/audit.md`). */
export const PerformanceActivityRecorded = activityRecorded('performance');

export const performanceEvents = [
  PerformanceActivityRecorded,
  CycleStateChanged,
  ReviewStatusChanged,
  ReviewReleased,
  TemplatePublished,
  FeedbackGiven,
  GoalCheckedIn,
  LearningCompleted,
  RatingFinalized,
] as const;
