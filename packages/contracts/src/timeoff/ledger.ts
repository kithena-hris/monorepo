import * as z from 'zod';

import { asFreeText, asInternal, asPublic, policy } from '../classification.js';
import { CalendarDate, Instant, PersonId } from '../primitives.js';
import { DayAmount, LeaveTypeKey, LeaveUnit } from './primitives.js';

/**
 * The balance ledger (PRD §7.1). Append-only: a correction is a new entry that
 * names the one it `supersedes`, and every number on a screen is a fold over
 * these rows.
 */
export const LedgerEntryKind = z
  .enum([
    'grant',
    'accrual',
    'carry_over',
    'expiry',
    'booking',
    'taken',
    'release',
    'borrow',
    'adjustment',
    'comp_earned',
  ])
  .register(policy, asInternal());
export type LedgerEntryKind = z.infer<typeof LedgerEntryKind>;

/** One row, as "Where the days went" (MT20) shows it. */
export const LedgerEntry = z.object({
  entryId: z.uuid().register(policy, asPublic()),
  personId: PersonId,
  leaveTypeKey: LeaveTypeKey,
  kind: LedgerEntryKind,
  /** Signed, in the leave type's unit: days, or hours for comp time. */
  amount: DayAmount,
  unit: LeaveUnit,
  /** The domain date the entry counts from. `occurredAt` is when it was recorded. */
  effectiveOn: CalendarDate,
  occurredAt: Instant,
  /** The policy version that produced it; `null` for a booking or an HR adjustment. */
  policyVersion: z.int().positive().nullable().register(policy, asInternal()),
  supersedes: z.uuid().nullable().register(policy, asPublic()),
  requestId: z.uuid().nullable().register(policy, asPublic()),
  /** Required on an adjustment by the domain; HR's words, so free text. */
  reason: z.string().max(1000).nullable().register(policy, asFreeText()),
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;
