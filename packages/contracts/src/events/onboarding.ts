import * as z from 'zod';

import { asInternal, asPublic, policy } from '../classification.js';
import { defineEvent } from '../event.js';
import { activityRecorded } from './activity.js';
import { CalendarDate } from '../primitives.js';
import {
  HireId,
  OnboardingTaskId,
  OwnerRole,
  PlanId,
  ProbationOutcome,
} from '../onboarding/primitives.js';

/**
 * Onboarding's events (Recruiting PRD §O2). No payload carries a name, an
 * address or anything the new hire filled in: People holds those, and a task
 * is named by its id. `onboarding.probation.reviewed` is what People records
 * as `probation_outcome`.
 */

const memberId = () => z.uuid().register(policy, asPublic());

export const PlanStarted = defineEvent(
  'onboarding.plan.started',
  1,
  z.object({
    planId: PlanId,
    hireId: HireId,
    personId: memberId().nullable(),
    startDate: CalendarDate,
    /** When probation ends, for a probation review in Performance; absent from older events. */
    probationEnd: CalendarDate.nullable().optional(),
    tasks: z.int().nonnegative().register(policy, asInternal()),
  }),
);

export const OnboardingTaskCompleted = defineEvent(
  'onboarding.task.completed',
  1,
  z.object({
    planId: PlanId,
    taskId: OnboardingTaskId,
    ownerRole: OwnerRole,
    late: z.boolean().register(policy, asInternal()),
  }),
);

export const PlanCompleted = defineEvent(
  'onboarding.plan.completed',
  1,
  z.object({ planId: PlanId, hireId: HireId, personId: memberId().nullable() }),
);

export const PlanCancelled = defineEvent(
  'onboarding.plan.cancelled',
  1,
  z.object({ planId: PlanId, hireId: HireId }),
);

export const ProbationReviewed = defineEvent(
  'onboarding.probation.reviewed',
  1,
  z.object({
    planId: PlanId,
    personId: memberId().nullable(),
    outcome: ProbationOutcome,
    /** Extended: the new end. */
    probationEnd: CalendarDate.nullable(),
    by: memberId(),
  }),
);

/** Every act in Onboarding, in words, for the company's activity log (`docs/audit.md`). */
export const OnboardingActivityRecorded = activityRecorded('onboarding');

export const onboardingEvents = [
  OnboardingActivityRecorded,
  PlanStarted,
  OnboardingTaskCompleted,
  PlanCompleted,
  PlanCancelled,
  ProbationReviewed,
] as const;
