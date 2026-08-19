import * as z from 'zod';
import { defineEvent } from '../event.js';
import { CalendarDate, PersonId } from '../primitives.js';
import { policy, asFreeText, asInternal, asPublic, asSpecialCategory } from '../classification.js';

export const AbsenceKind = z.enum([
  'annual_leave',
  'sick_leave',
  'parental_leave',
  'unpaid_leave',
  'public_holiday',
  'other',
]);
export type AbsenceKind = z.infer<typeof AbsenceKind>;

/** Payroll needs to know whether an absence is paid and whose rules apply.
 *  This is the minimum an external payroll engine can work from. */
export const PayrollTreatment = z.object({
  paid: z.boolean().register(policy, asInternal()),
  statutory: z.boolean().register(policy, asInternal()),
  /** ISO 3166-1 alpha-2. Whose statutory rules apply, not where anyone lives. */
  jurisdiction: z.string().length(2).register(policy, asPublic()),
});

export const LeaveRequested = defineEvent(
  'timeoff.request.requested',
  1,
  z.object({
    requestId: z.uuid().register(policy, asPublic()),
    personId: PersonId,
    kind: AbsenceKind.register(policy, asPublic()),
    from: CalendarDate,
    to: CalendarDate,
    /** Half days at the boundaries, because every HRIS eventually needs them. */
    startsHalfDay: z.boolean().default(false).register(policy, asInternal()),
    endsHalfDay: z.boolean().default(false).register(policy, asInternal()),
    /** A sick-leave note is health data under Article 9. Special-category
     *  storage, excluded from model prompts by the AI gateway. */
    medicalNote: z.string().nullable().register(policy, asSpecialCategory('health')),
  }),
);

export const LeaveApproved = defineEvent(
  'timeoff.request.approved',
  1,
  z.object({
    requestId: z.uuid().register(policy, asPublic()),
    personId: PersonId,
    approvedBy: z.uuid().register(policy, asPublic()),
    workingDays: z.number().nonnegative().register(policy, asInternal()),
    payroll: PayrollTreatment,
  }),
);

export const LeaveRejected = defineEvent(
  'timeoff.request.rejected',
  1,
  z.object({
    requestId: z.uuid().register(policy, asPublic()),
    personId: PersonId,
    rejectedBy: z.uuid().register(policy, asPublic()),
    reason: z.string().nullable().register(policy, asFreeText()),
  }),
);

/** A correction, not an update. Payroll computes the delta, so it needs to
 *  know which event this replaces. */
export const LeaveCorrected = defineEvent(
  'timeoff.request.corrected',
  1,
  z.object({
    requestId: z.uuid().register(policy, asPublic()),
    personId: PersonId,
    supersedesEventId: z.uuidv7().register(policy, asPublic()),
    workingDays: z.number().nonnegative().register(policy, asInternal()),
    payroll: PayrollTreatment,
  }),
);

export const timeoffEvents = [
  LeaveRequested,
  LeaveApproved,
  LeaveRejected,
  LeaveCorrected,
] as const;
