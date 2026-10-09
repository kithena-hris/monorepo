import {
  err,
  failure,
  Forbidden,
  NotFound,
  ok,
  type DomainFailure,
  type PendingEvent,
  type Result,
} from '@kithena/domain-kit';
import {
  BalanceAdjusted,
  CalendarDate,
  type LedgerEntry,
  type LeaveTypeKey,
  type PersonId,
  type PolicyDefinition,
  type TenantId,
  type TimeOffPredicate,
} from '@kithena/contracts';

import { append, balanceOn, type Balance } from '../domain/balance/ledger.js';
import { holidayDates } from '../domain/calendar/holiday-calendar.js';
import { MONDAY_TO_FRIDAY, type WorkCalendar } from '../domain/calendar/working-days.js';
import { envelope, type EventContext } from '../domain/context.js';
import { addDays, addMonths } from '../domain/days.js';
import type { Policy } from '../domain/policy/policy.js';
import type { Caller, Deps, Member, Relation, Tx } from './ports.js';

/** Thrown inside a unit of work to roll it back with a refusal, and caught right outside it. */
class Rollback extends Error {
  readonly refusal: DomainFailure;
  constructor(refusal: DomainFailure) {
    super(refusal.code);
    this.refusal = refusal;
  }
}

/** One transaction whose refusal rolls it back, answered as a `Result` rather than a throw. */
export async function transact<T>(
  deps: Pick<Deps, 'uow'>,
  tenantId: TenantId,
  fn: (tx: Tx) => Promise<Result<T>>,
): Promise<Result<T>> {
  try {
    const value = await deps.uow.run(tenantId, async (tx) => {
      const result = await fn(tx);
      if (!result.ok) throw new Rollback(result.error);
      return result.value;
    });
    return ok(value);
  } catch (error) {
    if (error instanceof Rollback) return err(error.refusal);
    throw error;
  }
}

export const forbidden = (): Result<never> => err(Forbidden());
export const notFound = (what: string): Result<never> => err(NotFound(what));
export const refuse = (code: string, message: string, path?: readonly string[]): Result<never> =>
  err(failure(code, message, path));

/**
 * Said to an account no member holds, on every screen that is somebody's own.
 * Time Off's members are the people People has hired (`hired` puts the
 * account on one); an account whose record is still provisional, or one with
 * no record, has no balances, no approver and nothing to request from.
 */
export const NOT_A_MEMBER =
  'Time Off does not have you as an employee yet, so there is no time off or attendance of yours here. There will be once HR hires you in People.';

/**
 * A keyset page's place: the sort key and the id of the last row, as one
 * opaque string the screen hands back. A garbled one is the first page.
 */
export const pageCursor = {
  of: (key: string, id: string): string => `${key}~${id}`,
  read: (cursor: string | null): { key: string; id: string } | null => {
    const m = cursor === null ? null : /^([0-9T:.Z+-]{10,40})~([0-9a-f-]{36})$/u.exec(cursor);
    return m === null ? null : { key: m[1] ?? '', id: m[2] ?? '' };
  },
};

/** The caller's own member, or the refusal above when Time Off holds none for them. */
export async function self(tx: Tx, caller: Caller): Promise<Result<Member>> {
  const member = caller.personId === null ? null : await tx.members.get(caller.personId);
  return member === null ? refuse('FORBIDDEN', NOT_A_MEMBER) : ok(member);
}

/* --------------------------------------------------------- authorization -- */

/** Whether the caller holds `relation` on a member. A caller who is not a member holds none. */
export async function relates(
  deps: Pick<Deps, 'authz'>,
  caller: Caller,
  relation: Exclude<Relation, 'hr_admin'>,
  personId: PersonId,
): Promise<boolean> {
  if (caller.personId === null) return false;
  return deps.authz.check(caller.tenantId, {
    user: `person:${caller.personId}`,
    relation,
    object: `member:${personId}`,
  });
}

/**
 * The members the caller holds `relation` on, as one question to OpenFGA
 * (`ListObjects`) rather than a check per member: a screen over the company
 * asked hundreds, and asked at once they swamped it. None for a caller who
 * is not a member.
 */
export async function relatedIds(
  deps: Pick<Deps, 'authz'>,
  caller: Caller,
  relation: Exclude<Relation, 'hr_admin'>,
): Promise<ReadonlySet<string>> {
  if (caller.personId === null) return new Set();
  return new Set(await deps.authz.members(caller.tenantId, `person:${caller.personId}`, relation));
}

export const isHrAdmin = (deps: Pick<Deps, 'authz'>, caller: Caller): Promise<boolean> =>
  deps.authz.check(caller.tenantId, {
    user: `account:${caller.accountId}`,
    relation: 'hr_admin',
    object: `tenant:${caller.tenantId}`,
  });

/** The member themselves, or HR. */
export async function selfOrHr(
  deps: Pick<Deps, 'authz'>,
  caller: Caller,
  personId: PersonId,
): Promise<boolean> {
  return caller.personId === personId || isHrAdmin(deps, caller);
}

/* -------------------------------------------------------------- calendar -- */

const yearOf = (date: CalendarDate): number => Number(date.slice(0, 4));

/**
 * The member's working week and their location's holidays, for every year
 * from the one before `from` to the one after `to`: days away reaches past a
 * request's own dates, and across New Year.
 */
export async function calendarOf(
  tx: Tx,
  member: Member,
  from: CalendarDate,
  to: CalendarDate,
): Promise<WorkCalendar> {
  const keys = member.locationKey === null ? [] : await tx.holidays.assigned(member.locationKey);
  const layers = (await tx.holidays.layers())
    .filter((l) => keys.includes(l.key))
    .toSorted((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));
  const holidays = new Set<CalendarDate>();
  for (let y = yearOf(from) - 1; y <= yearOf(to) + 1; y++) {
    for (const day of holidayDates(layers, y)) holidays.add(day);
  }
  return {
    pattern: member.workPattern === null ? MONDAY_TO_FRIDAY : new Set(member.workPattern),
    holidays,
  };
}

/* ---------------------------------------------------------------- policy -- */

/** Whether a policy's or leave type's `appliesTo` holds for a member. Null applies to all. */
export function applies(predicate: TimeOffPredicate | null, member: Member): boolean {
  if (predicate === null) return true;
  const held = predicate.clauses.map((c) => {
    switch (c.operand) {
      case 'country':
        return member.country !== null && (c.in as readonly string[]).includes(member.country);
      case 'location':
        return member.locationKey !== null && c.in.includes(member.locationKey);
      // The projection holds neither (§5.2), so a clause on them never holds here.
      case 'legalEntity':
      case 'employmentType':
        return false;
    }
  });
  return predicate.combine === 'all' ? held.every(Boolean) : held.some(Boolean);
}

/** The member's policy for a leave type, with the version in effect on `on`. */
export async function policyFor(
  tx: Tx,
  member: Member,
  leaveTypeKey: LeaveTypeKey,
  on: CalendarDate,
): Promise<{ policy: Policy; version: number; definition: PolicyDefinition } | null> {
  return policyFrom(await tx.policies.forLeaveType(leaveTypeKey), member, on);
}

/** `policyFor` over a leave type's policies already read: the first in effect that applies. */
export function policyFrom(
  policies: readonly Policy[],
  member: Member,
  on: CalendarDate,
): { policy: Policy; version: number; definition: PolicyDefinition } | null {
  for (const policy of policies) {
    const v = policy.inEffectOn(on);
    if (v !== null && applies(v.definition.appliesTo, member)) {
      return { policy, version: v.version, definition: v.definition };
    }
  }
  return null;
}

/** The leave year a date falls in: its calendar start year, first and last day. */
export function leaveYear(
  definition: Pick<PolicyDefinition, 'year'> | null,
  on: CalendarDate,
): { year: number; start: CalendarDate; end: CalendarDate } {
  const { month, day } = definition?.year ?? { month: 1, day: 1 };
  const startIn = (y: number) =>
    CalendarDate.parse(
      `${String(y)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    );
  const year = on < startIn(yearOf(on)) ? yearOf(on) - 1 : yearOf(on);
  const start = startIn(year);
  return { year, start, end: addDays(addMonths(start, 12), -1) };
}

/* ---------------------------------------------------------------- ledger -- */

/** Rows not replaced by a later correction. */
export function live(entries: readonly LedgerEntry[]): LedgerEntry[] {
  const replaced = new Set(entries.map((e) => e.supersedes).filter((id) => id !== null));
  return entries.filter((e) => !replaced.has(e.entryId));
}

/** Append through the domain's `append`, so every invariant it guards holds on the way in. */
export async function post(tx: Tx, entries: readonly LedgerEntry[]): Promise<Result<void>> {
  const byMember = new Map<PersonId, LedgerEntry[]>();
  for (const e of entries) byMember.set(e.personId, [...(byMember.get(e.personId) ?? []), e]);
  for (const [personId, mine] of byMember) {
    let ledger: readonly LedgerEntry[] = await tx.ledger.forMember(personId);
    for (const e of mine) {
      const next = append(ledger, e);
      if (!next.ok) return next;
      ledger = next.value;
    }
  }
  if (entries.length > 0) await tx.ledger.append(entries);
  return ok(undefined);
}

/** `timeoff.balance.adjusted` for each adjustment, expiry or carry-over among `entries`. */
export function adjustedEvents(
  ctx: EventContext,
  tenantId: TenantId,
  entries: readonly LedgerEntry[],
): PendingEvent[] {
  return entries
    .filter(
      (e): e is LedgerEntry & { kind: 'adjustment' | 'expiry' | 'carry_over' } =>
        e.kind === 'adjustment' || e.kind === 'expiry' || e.kind === 'carry_over',
    )
    .map((e) =>
      envelope(ctx, {
        tenantId,
        eventName: BalanceAdjusted.name,
        eventVersion: BalanceAdjusted.version,
        effectiveFrom: e.effectiveOn,
        aggregate: { type: 'Ledger', id: e.personId, version: 1 },
        payload: BalanceAdjusted.payload.parse({
          entryId: e.entryId,
          personId: e.personId,
          leaveTypeKey: e.leaveTypeKey,
          kind: e.kind,
          delta: e.amount,
          unit: e.unit,
          reason: e.reason,
        }),
      }),
    );
}

/**
 * A member's balance of one leave type on a date, folded over the leave year
 * it falls in. `excluding` leaves one request's rows out: "what was left
 * before this request" for the approver's queue.
 */
export async function balanceFor(
  tx: Tx,
  member: Member,
  leaveTypeKey: LeaveTypeKey,
  on: CalendarDate,
  excluding: string | null = null,
): Promise<Balance> {
  const policy = await policyFor(tx, member, leaveTypeKey, on);
  const { start, end } = leaveYear(policy?.definition ?? null, on);
  const entries = (await tx.ledger.forMember(member.personId, leaveTypeKey)).filter(
    (e) =>
      e.effectiveOn >= start &&
      e.effectiveOn <= end &&
      (excluding === null || e.requestId !== excluding),
  );
  return balanceOn(entries, on);
}
