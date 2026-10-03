import { err, failure, ok, type Result } from '@kithena/domain-kit';
import {
  LedgerEntry,
  type CalendarDate,
  type DayAmount,
  type LedgerEntryKind,
  type LeaveTypeKey,
  type LeaveUnit,
  type PersonId,
} from '@kithena/contracts';

import type { EventContext } from '../context.js';
import { amount, days, sum, type Decimal } from '../days.js';

/**
 * The balance ledger and its fold (PRD §7.1, §7.2).
 *
 * Append-only. A correction is a new entry naming the one it `supersedes`;
 * nothing is ever edited, so "why do I have 11.5?" always has an answer made
 * of rows that were true when they were written.
 *
 * A booking settles into `taken` as a pair: a `release` of what was booked
 * and a `taken` of the same amount. Every entry then keeps the sign the PRD
 * gives its kind, and `left` stays the plain sum of the rows.
 */

export type { LedgerEntry };

/** What `entry` needs; the id and `occurredAt` come from the context. */
export interface NewEntry {
  readonly personId: PersonId;
  readonly leaveTypeKey: LeaveTypeKey;
  readonly unit: LeaveUnit;
  readonly kind: LedgerEntryKind;
  readonly amount: DayAmount | Decimal | string;
  readonly effectiveOn: CalendarDate;
  readonly policyVersion?: number | null;
  readonly supersedes?: string | null;
  readonly requestId?: string | null;
  readonly reason?: string | null;
}

/** One new row, parsed through the contract so a bad amount fails here. */
export function entry(fields: NewEntry, ctx: Pick<EventContext, 'newId' | 'clock'>): LedgerEntry {
  return LedgerEntry.parse({
    entryId: ctx.newId(),
    personId: fields.personId,
    leaveTypeKey: fields.leaveTypeKey,
    kind: fields.kind,
    amount: amount(fields.amount),
    unit: fields.unit,
    effectiveOn: fields.effectiveOn,
    occurredAt: ctx.clock.instant(),
    policyVersion: fields.policyVersion ?? null,
    supersedes: fields.supersedes ?? null,
    requestId: fields.requestId ?? null,
    reason: fields.reason ?? null,
  });
}

/** The sign each kind may carry. An adjustment goes either way. */
const SIGN: Record<LedgerEntryKind, 'credit' | 'debit' | 'either'> = {
  grant: 'credit',
  accrual: 'credit',
  carry_over: 'credit',
  release: 'credit',
  borrow: 'credit',
  comp_earned: 'credit',
  expiry: 'debit',
  booking: 'debit',
  taken: 'debit',
  adjustment: 'either',
};

/** The ledger with one more row, or why not. The ledger passed in is never touched. */
export function append(
  ledger: readonly LedgerEntry[],
  next: LedgerEntry,
): Result<readonly LedgerEntry[]> {
  if (ledger.some((e) => e.entryId === next.entryId)) {
    return err(failure('DUPLICATE_ENTRY', 'This entry is already in the ledger'));
  }
  if (next.supersedes !== null) {
    if (!ledger.some((e) => e.entryId === next.supersedes)) {
      return err(
        failure('UNKNOWN_ENTRY', 'A correction must name an entry in this ledger', ['supersedes']),
      );
    }
    if (ledger.some((e) => e.supersedes === next.supersedes)) {
      return err(
        failure('ALREADY_SUPERSEDED', 'That entry was already corrected; correct the correction', [
          'supersedes',
        ]),
      );
    }
  }
  const sign = SIGN[next.kind];
  const negative = next.amount.startsWith('-');
  if ((sign === 'credit' && negative) || (sign === 'debit' && days(next.amount).gt(0))) {
    return err(failure('WRONG_SIGN', `A ${next.kind} cannot be ${next.amount}`, ['amount']));
  }
  if (next.kind === 'adjustment' && (next.reason ?? '').trim() === '') {
    return err(failure('REASON_REQUIRED', 'An adjustment always says why', ['reason']));
  }
  return ok(Object.freeze([...ledger, Object.freeze(next)]));
}

/** What a balance card shows (PRD §7.2). */
export interface Balance {
  readonly left: DayAmount;
  readonly used: DayAmount;
  /** Pending and approved but not yet taken. */
  readonly booked: DayAmount;
  /** The year's grant and accruals, including months not yet credited. */
  readonly allowance: DayAmount;
}

/** Rows that count: those not replaced by a correction that also counts. */
function live(entries: readonly LedgerEntry[]): readonly LedgerEntry[] {
  const replaced = new Set(entries.map((e) => e.supersedes).filter((id) => id !== null));
  return entries.filter((e) => !replaced.has(e.entryId));
}

const total = (entries: readonly LedgerEntry[], kinds: readonly LedgerEntryKind[]): Decimal =>
  sum(entries.filter((e) => kinds.includes(e.kind)).map((e) => days(e.amount)));

/**
 * The balance on a date: the sum of the rows effective on or before it.
 *
 * Pass one leave type's rows for one leave year. A `borrow` is a marker of
 * how far below zero a booking went, not days, so it is never summed.
 */
export function balanceOn(ledger: readonly LedgerEntry[], on: CalendarDate): Balance {
  const effective = live(ledger.filter((e) => e.effectiveOn <= on));
  return {
    left: amount(sum(effective.filter((e) => e.kind !== 'borrow').map((e) => days(e.amount)))),
    used: amount(total(effective, ['taken']).neg()),
    booked: amount(total(effective, ['booking', 'release']).neg()),
    allowance: amount(total(live(ledger), ['grant', 'accrual'])),
  };
}
