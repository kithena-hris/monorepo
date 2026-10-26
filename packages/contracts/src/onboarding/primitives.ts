import * as z from 'zod';

import { asContact, asIdentity, asInternal, asPublic, policy } from '../classification.js';
import { CalendarDate, LegalEntityId } from '../primitives.js';
import { LaunchCountry, WorkMode } from '../recruiting/primitives.js';

/**
 * Onboarding's vocabulary (Recruiting PRD Part II, ONB-002): its ids, the
 * phases and owner roles a plan is written in, and the hire it starts from,
 * whichever system the hire came from.
 */

export const PlanId = z.uuid().brand<'PlanId'>().register(policy, asPublic());
export type PlanId = z.infer<typeof PlanId>;
export const OnboardingTaskId = z.uuid().brand<'OnboardingTaskId'>().register(policy, asPublic());
export type OnboardingTaskId = z.infer<typeof OnboardingTaskId>;
export const HireId = z.uuid().brand<'HireId'>().register(policy, asPublic());
export type HireId = z.infer<typeof HireId>;

/** When a task falls (§O3). */
export const Phase = z
  .enum(['before_start', 'day_one', 'first_week', 'first_month', 'probation'])
  .register(policy, asPublic());
export type Phase = z.infer<typeof Phase>;

/** Who a task is for (§O3); a named person is `person` with their id on the task. */
export const OwnerRole = z
  .enum(['new_hire', 'manager', 'buddy', 'hr', 'it', 'person'])
  .register(policy, asPublic());
export type OwnerRole = z.infer<typeof OwnerRole>;

/**
 * What a task is, beyond a line to tick: `form` links People's onboarding
 * section, `document` a Documents request, `acknowledge` a Documents policy;
 * `goal` and `training` open Performance, where the first goals are agreed
 * and the onboarding learning assigned (Performance PRD §15, Recruiting PRD
 * §O3). A company without that module sees a plain task.
 */
export const TaskKind = z
  .enum([
    'todo',
    'form',
    'document',
    'acknowledge',
    'meeting',
    'equipment',
    'account',
    'goal',
    'training',
  ])
  .register(policy, asPublic());
export type TaskKind = z.infer<typeof TaskKind>;

export const ProbationOutcome = z
  .enum(['passed', 'extended', 'failed'])
  .register(policy, asInternal());
export type ProbationOutcome = z.infer<typeof ProbationOutcome>;

/**
 * A hire as Onboarding takes it (§O2): from Recruiting's or People's event,
 * or `POST /v1/onboarding/hires` from another ATS. Only what a plan needs:
 * who, when, where, under what terms, and who manages them.
 */
export const HireIntake = z.object({
  /** The source's own id for the hire, so a repeat is the same hire. */
  externalId: z.string().min(1).max(120).register(policy, asInternal()),
  source: z.enum(['recruiting', 'people', 'webhook']).register(policy, asInternal()),
  givenName: z.string().min(1).max(200).register(policy, asIdentity()),
  familyName: z.string().max(200).register(policy, asIdentity()),
  email: z.email().register(policy, asContact()),
  /** People's person, once there is one. */
  personId: z.uuid().nullable().register(policy, asPublic()),
  managerId: z.uuid().nullable().register(policy, asPublic()),
  startDate: CalendarDate,
  probationEnd: CalendarDate.nullable(),
  country: LaunchCountry,
  legalEntityId: LegalEntityId.nullable(),
  location: z.string().max(200).nullable().register(policy, asInternal()),
  department: z.string().max(120).nullable().register(policy, asInternal()),
  workMode: WorkMode,
  contractType: z.string().max(80).nullable().register(policy, asInternal()),
  /** How far probation may be extended, in months, from the terms pack; null where it may not. */
  probationExtensionMonths: z.int().min(0).max(12).nullable().register(policy, asInternal()),
});
export type HireIntake = z.infer<typeof HireIntake>;

/** An onboarding task in the Inbox (ONB-012), ticked off there; what it links opens beside it. */
export const OnboardingTaskDetail = z.object({
  planId: z.string().min(1).max(64).register(policy, asPublic()),
  taskId: z.string().min(1).max(64).register(policy, asPublic()),
  kind: TaskKind,
  /** A People form, a Documents request or a policy, when the kind links one. */
  link: z.string().max(500).nullable().register(policy, asPublic()),
});
export type OnboardingTaskDetail = z.infer<typeof OnboardingTaskDetail>;
