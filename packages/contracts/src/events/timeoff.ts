import * as z from 'zod';
import { defineEvent, EventEnvelope } from '../event.js';
import { CalendarDate, Instant, PersonId } from '../primitives.js';
import { policy, asFreeText, asInternal, asPublic, asSpecialCategory } from '../classification.js';
import {
  AbsenceKind,
  AttendanceWorkModel,
  DayAmount,
  HourAmount,
  LeaveCategory,
  LeaveTypeKey,
  LeaveUnit,
  PunchKind,
  PunchSource,
} from '../timeoff/primitives.js';

/**
 * Time Off's events (PRD §13).
 *
 * Two things no payload here may hold, and `timeoff.test.ts` walks every one
 * to prove it: a coordinate, and the body of a sick note. A punch records the
 * work model it derived, never where the phone was (§11.2); a sick note leaves
 * the aggregate as `notePresent` and nothing else (§8.5).
 *
 * Day counts on new events are `DayAmount` strings. The v1 events that already
 * existed keep their `number`, because changing a published field's type is a
 * new version, not an edit.
 */

/** Payroll needs to know whether an absence is paid and whose rules apply.
 *  This is the minimum an external payroll engine can work from. */
export const PayrollTreatment = z.object({
  paid: z.boolean().register(policy, asInternal()),
  statutory: z.boolean().register(policy, asInternal()),
  /** ISO 3166-1 alpha-2. Whose statutory rules apply, not where anyone lives. */
  jurisdiction: z.string().length(2).register(policy, asPublic()),
});

const requestId = () => z.uuid().register(policy, asPublic());
const accountId = () => z.uuid().register(policy, asPublic());
const halfDay = () => z.boolean().default(false).register(policy, asInternal());
/** The event a correction replaces. Payroll computes the delta from it. */
const supersedes = () => z.uuidv7().register(policy, asPublic());

/**
 * v1, kept to read what was written with it and no longer published.
 *
 * It hardcoded `startsHalfDay: false`, knew no tenant leave type, and carried
 * the sick note's text in `medicalNote` — Article 9 data in a Kafka payload,
 * which §8.5 forbids. Nothing produces it now; `readLeaveRequested` lifts any
 * v1 message still on `kithena.timeoff.v1` into v2.
 */
export const LeaveRequestedV1 = defineEvent(
  'timeoff.request.requested',
  1,
  z.object({
    requestId: requestId(),
    personId: PersonId,
    kind: AbsenceKind.register(policy, asPublic()),
    from: CalendarDate,
    to: CalendarDate,
    startsHalfDay: halfDay(),
    endsHalfDay: halfDay(),
    medicalNote: z.string().nullable().register(policy, asSpecialCategory('health')),
  }),
);

export const LeaveRequested = defineEvent(
  'timeoff.request.requested',
  2,
  z.object({
    requestId: requestId(),
    personId: PersonId,
    /** The tenant's own type, `vacation` or `comp`. */
    leaveTypeKey: LeaveTypeKey,
    /** What it means to a consumer that knows no tenant types. */
    category: LeaveCategory,
    from: CalendarDate,
    to: CalendarDate,
    startsHalfDay: halfDay(),
    endsHalfDay: halfDay(),
    /** The cost (§7.3). `null` only on a request upcast from v1, which never recorded it. */
    workingDays: DayAmount.nullable(),
    /** The request borrows below zero (§7.4). */
    belowZero: z.boolean().register(policy, asInternal()),
    /** A sick note was attached. The note itself never leaves Time Off. */
    notePresent: z.boolean().register(policy, asInternal()),
  }),
);

type LeaveRequestedV1Payload = z.infer<typeof LeaveRequestedV1.payload>;
type LeaveRequestedPayload = z.infer<typeof LeaveRequested.payload>;

/** The type a v1 kind most plausibly was, before tenants had their own. */
const V1_TYPE: Record<AbsenceKind, string> = {
  annual_leave: 'vacation',
  sick_leave: 'sick',
  parental_leave: 'parental',
  unpaid_leave: 'unpaid',
  public_holiday: 'other',
  other: 'other',
};

/** v1 → v2. Pure, and the one place the mapping lives. */
export function upcastLeaveRequestedV1(v1: LeaveRequestedV1Payload): LeaveRequestedPayload {
  return LeaveRequested.payload.parse({
    requestId: v1.requestId,
    personId: v1.personId,
    leaveTypeKey: V1_TYPE[v1.kind],
    category: v1.kind === 'public_holiday' ? 'other' : v1.kind,
    from: v1.from,
    to: v1.to,
    startsHalfDay: v1.startsHalfDay,
    endsHalfDay: v1.endsHalfDay,
    workingDays: null,
    // v1 refused any request over the balance, so none went below zero.
    belowZero: false,
    notePresent: v1.medicalNote !== null,
  });
}

/**
 * Read a `timeoff.request.requested` of either version as v2.
 *
 * What a consumer calls instead of `LeaveRequested.parse`. A version it does
 * not know is refused rather than read as the latest, because reading a v3
 * payload through the v2 schema strips whatever v3 added and reports success.
 */
export function readLeaveRequested(input: unknown): EventEnvelope & {
  eventName: typeof LeaveRequested.name;
  eventVersion: 2;
  payload: LeaveRequestedPayload;
} {
  const envelope = EventEnvelope.extend({
    eventName: z.literal(LeaveRequested.name),
    eventVersion: z.union([z.literal(1), z.literal(2)]),
    payload: z.unknown(),
  }).parse(input);
  const payload =
    envelope.eventVersion === 1
      ? upcastLeaveRequestedV1(LeaveRequestedV1.payload.parse(envelope.payload))
      : LeaveRequested.payload.parse(envelope.payload);
  return { ...envelope, eventVersion: 2, payload };
}

export const LeaveApproved = defineEvent(
  'timeoff.request.approved',
  1,
  z.object({
    requestId: requestId(),
    personId: PersonId,
    approvedBy: accountId(),
    workingDays: z.number().nonnegative().register(policy, asInternal()),
    payroll: PayrollTreatment,
  }),
);

export const LeaveRejected = defineEvent(
  'timeoff.request.rejected',
  1,
  z.object({
    requestId: requestId(),
    personId: PersonId,
    rejectedBy: accountId(),
    reason: z.string().nullable().register(policy, asFreeText()),
  }),
);

/** A correction, not an update. Payroll computes the delta, so it needs to
 *  know which event this replaces. */
export const LeaveCorrected = defineEvent(
  'timeoff.request.corrected',
  1,
  z.object({
    requestId: requestId(),
    personId: PersonId,
    supersedesEventId: supersedes(),
    workingDays: z.number().nonnegative().register(policy, asInternal()),
    payroll: PayrollTreatment,
  }),
);

/** Dates and their cost, as a proposal or a change carries them. */
const span = () =>
  z.object({
    from: CalendarDate,
    to: CalendarDate,
    startsHalfDay: halfDay(),
    endsHalfDay: halfDay(),
    workingDays: DayAmount,
  });

/** The manager suggested other dates (§9.5, T18). */
export const LeaveCounterProposed = defineEvent(
  'timeoff.request.counter_proposed',
  1,
  z.object({
    requestId: requestId(),
    personId: PersonId,
    proposedBy: accountId(),
    // Classified whole: the codegen walk does not descend into arrays.
    proposals: z.array(span()).min(1).max(3).register(policy, asInternal()),
  }),
);

/** New dates approved; the old booking is released by this (§8.4). */
export const LeaveChanged = defineEvent(
  'timeoff.request.changed',
  1,
  span().extend({
    requestId: requestId(),
    personId: PersonId,
    supersedes: supersedes(),
  }),
);

/** Cancelled, or shortened: the days given back (§8.4). */
export const LeaveCancelled = defineEvent(
  'timeoff.request.cancelled',
  1,
  z.object({
    requestId: requestId(),
    personId: PersonId,
    /** The released days. The whole request when cancelled; the tail when shortened. */
    from: CalendarDate,
    to: CalendarDate,
    releasedDays: DayAmount,
    shortened: z.boolean().register(policy, asInternal()),
  }),
);

/** An HR adjustment, an expiry or a carry-over posted to the ledger (§7.1). */
export const BalanceAdjusted = defineEvent(
  'timeoff.balance.adjusted',
  1,
  z.object({
    entryId: z.uuid().register(policy, asPublic()),
    personId: PersonId,
    leaveTypeKey: LeaveTypeKey,
    kind: z.enum(['adjustment', 'expiry', 'carry_over']).register(policy, asInternal()),
    /** Signed, in `unit`. */
    delta: DayAmount,
    unit: LeaveUnit,
    /** HR's reason on an adjustment; `null` on an expiry or a carry-over. */
    reason: z.string().max(1000).nullable().register(policy, asFreeText()),
  }),
);

/** A policy version published; balances re-fold from `effectiveFrom` (§6.3). */
export const PolicyPublished = defineEvent(
  'timeoff.policy.published',
  1,
  z.object({
    policyId: z.uuid().register(policy, asPublic()),
    version: z.int().positive().register(policy, asPublic()),
    leaveTypeKey: LeaveTypeKey,
    effectiveFrom: CalendarDate,
  }),
);

/** A punch. **No coordinates** (§11.2). */
export const AttendancePunched = defineEvent(
  'timeoff.attendance.punched',
  1,
  z.object({
    punchId: z.uuid().register(policy, asPublic()),
    personId: PersonId,
    at: Instant,
    kind: PunchKind,
    source: PunchSource,
    workModel: AttendanceWorkModel,
    deviceId: z.uuid().nullable().register(policy, asPublic()),
    /** `null` unless a geofence policy is on. */
    insideOfficeArea: z.boolean().nullable().register(policy, asInternal()),
  }),
);

/** A punch corrected, as a new punch naming the one it replaces (§11.4). */
export const AttendanceCorrected = defineEvent(
  'timeoff.attendance.corrected',
  1,
  z.object({
    punchId: z.uuid().register(policy, asPublic()),
    personId: PersonId,
    supersedes: supersedes(),
    at: Instant,
    kind: PunchKind,
    reason: z.string().max(1000).nullable().register(policy, asFreeText()),
  }),
);

/** A month closed (§11.8). One line per member, for Payroll. */
export const PeriodClosed = defineEvent(
  'timeoff.period.closed',
  1,
  z.object({
    periodId: z.uuid().register(policy, asPublic()),
    from: CalendarDate,
    to: CalendarDate,
    members: z
      .array(
        z.object({
          personId: PersonId,
          workedHours: HourAmount,
          overtimeHours: HourAmount,
          compHours: HourAmount,
          unpaidDays: DayAmount,
          negativeBalanceDays: DayAmount,
        }),
      )
      .register(policy, asInternal()),
  }),
);

/** The blocks of a parental leave plan (§12.2). */
const blocks = () =>
  z
    .array(
      z.object({
        leaveTypeKey: LeaveTypeKey,
        from: CalendarDate,
        to: CalendarDate,
        workingDays: DayAmount,
      }),
    )
    .min(1)
    .register(policy, asInternal());

export const ParentalPlanSubmitted = defineEvent(
  'timeoff.parental.plan_submitted',
  1,
  z.object({
    planId: z.uuid().register(policy, asPublic()),
    personId: PersonId,
    /** A due date says a pregnancy exists: health data under Article 9. */
    dueDate: CalendarDate.nullable().register(policy, asSpecialCategory('health')),
    blocks: blocks(),
  }),
);

export const ParentalPlanApproved = defineEvent(
  'timeoff.parental.plan_approved',
  1,
  z.object({
    planId: z.uuid().register(policy, asPublic()),
    personId: PersonId,
    approvedBy: accountId(),
    blocks: blocks(),
  }),
);

/** What Time Off publishes, one entry per event name. v1 of `requested` is read, not published. */
export const timeoffEvents = [
  LeaveRequested,
  LeaveApproved,
  LeaveRejected,
  LeaveCorrected,
  LeaveCounterProposed,
  LeaveChanged,
  LeaveCancelled,
  BalanceAdjusted,
  PolicyPublished,
  AttendancePunched,
  AttendanceCorrected,
  PeriodClosed,
  ParentalPlanSubmitted,
  ParentalPlanApproved,
] as const;
