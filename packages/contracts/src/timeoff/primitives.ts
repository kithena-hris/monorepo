import * as z from 'zod';

import { asInternal, asPublic, policy } from '../classification.js';
import { keySchema } from '../people/primitives.js';

/**
 * The vocabulary Time Off's contracts are written in (PRD §6.1, §7.1, §11.2).
 *
 * Here rather than in `events/timeoff.ts` because the policy, request, ledger
 * and attendance shapes need it too, and an event file importing a policy file
 * importing the event file is a cycle that fails at module evaluation.
 */

/**
 * What kind of absence this is, for a consumer that knows nothing about a
 * tenant's own leave types. Payroll reads this; it never reads `vacation`.
 */
export const AbsenceKind = z.enum([
  'annual_leave',
  'sick_leave',
  'parental_leave',
  'unpaid_leave',
  'public_holiday',
  'other',
]);
export type AbsenceKind = z.infer<typeof AbsenceKind>;

/**
 * The absence kind a leave type maps to. Every one but `public_holiday`, which
 * comes from a holiday calendar and is never requested.
 */
export const LeaveCategory = AbsenceKind.exclude(['public_holiday']).register(policy, asInternal());
export type LeaveCategory = z.infer<typeof LeaveCategory>;

/**
 * A tenant's leave type: `vacation`, `sick`, `comp`. Chosen once and never
 * edited, because a ledger row, an export header and somebody's integration
 * all hold it. The rules are People's attribute key rules, for People's reasons.
 */
export const LeaveTypeKey = keySchema('leave type')
  .brand<'LeaveTypeKey'>()
  .register(policy, asPublic());
export type LeaveTypeKey = z.infer<typeof LeaveTypeKey>;

/** A team, as Time Off's member projection holds it (PRD §5.2). */
export const TeamKey = keySchema('team').brand<'TeamKey'>().register(policy, asPublic());
export type TeamKey = z.infer<typeof TeamKey>;

/** A work location, which decides the holiday calendar (PRD §10.2). */
export const LocationKey = keySchema('location')
  .brand<'LocationKey'>()
  .register(policy, asPublic());
export type LocationKey = z.infer<typeof LocationKey>;

/**
 * An amount of days or hours, as a decimal string with exactly three places.
 *
 * A string because 25/12 is 2.0833… and a JS number carrying it into a ledger
 * makes a year of monthly accruals sum to 24.999999999999996. Three places
 * because the column is `numeric(9,3)` and that is what Postgres prints, so
 * one value has one spelling end to end. Signed, because an expiry and an
 * adjustment subtract — but never `-0.000`, which folds to nothing and reads
 * on a screen as a debt.
 */
const AMOUNT_SHAPE = /^-?(0|[1-9]\d{0,5})\.\d{3}$/u;

const amount = (what: string) =>
  z
    .string()
    .regex(AMOUNT_SHAPE, `${what} is a decimal with three places, such as 2.080`)
    .refine((v) => v !== '-0.000', `${what} cannot be negative zero`);

export const DayAmount = amount('A number of days')
  .brand<'DayAmount'>()
  .register(policy, asInternal());
export type DayAmount = z.infer<typeof DayAmount>;

export const HourAmount = amount('A number of hours')
  .brand<'HourAmount'>()
  .register(policy, asInternal());
export type HourAmount = z.infer<typeof HourAmount>;

/** An allowance, a cap or a limit: a `DayAmount` that cannot go below zero. */
export const NonNegativeDayAmount = amount('A number of days')
  .refine((v) => !v.startsWith('-'), 'cannot be negative')
  .brand<'DayAmount'>()
  .register(policy, asInternal());

/** Comp time is hours; everything else is days (PRD §6.1). */
export const LeaveUnit = z.enum(['day', 'hour']).register(policy, asPublic());
export type LeaveUnit = z.infer<typeof LeaveUnit>;

/**
 * Where someone worked, as derived at the moment of punching (PRD §11.2).
 *
 * Not People's `WorkModel`, which is a contract term a company defines. This
 * is what a punch records, and the location check that suggested it is never
 * stored.
 */
export const AttendanceWorkModel = z
  .enum(['office', 'remote', 'client'])
  .register(policy, asInternal());
export type AttendanceWorkModel = z.infer<typeof AttendanceWorkModel>;

export const PunchKind = z
  .enum(['in', 'out', 'break_start', 'break_end'])
  .register(policy, asInternal());
export type PunchKind = z.infer<typeof PunchKind>;

/** A badge reader or a kiosk, the web top bar, the phone (PRD §11.1). */
export const PunchSource = z.enum(['badge', 'kiosk', 'web', 'mobile']).register(policy, asPublic());
export type PunchSource = z.infer<typeof PunchSource>;
