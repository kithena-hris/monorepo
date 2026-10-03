import { ok, type Result } from '@kithena/domain-kit';
import type { CalendarDate, DayAmount, LedgerEntry } from '@kithena/contracts';

import { entitlement } from '../domain/balance/entitlement.js';
import { entry } from '../domain/balance/ledger.js';
import type { EventContext } from '../domain/context.js';
import type { Policy } from '../domain/policy/policy.js';
import type { Member, Tx } from './ports.js';
import { adjustedEvents, applies, leaveYear, live, post } from './shared.js';

/**
 * Posting what a policy grants, and re-posting it when the policy or the
 * member changes (PRD §6.3, §7.1).
 *
 * The domain's `entitlement` says what a whole leave year grants; this posts
 * the part of it that is due by `on` and not posted yet. Hire, the monthly
 * accrual and the year start all call it, so "posted once" is one rule: an
 * entry of the same kind on the same day is already there.
 */

const sameSlot = (a: LedgerEntry, b: LedgerEntry) =>
  a.kind === b.kind && a.effectiveOn === b.effectiveOn;

async function wanted(
  tx: Tx,
  ctx: EventContext,
  member: Member,
  policy: Policy,
  on: CalendarDate,
  carriedIn: DayAmount | null,
): Promise<{ entries: LedgerEntry[]; start: CalendarDate; end: CalendarDate } | null> {
  const version = policy.inEffectOn(on);
  if (version === null || !applies(version.definition.appliesTo, member)) return null;
  const leaveType = await tx.leaveTypes.get(version.definition.leaveTypeKey);
  if (leaveType === null || !leaveType.definition.tracked) return null;
  const { year, start, end } = leaveYear(version.definition, on);
  const entries = entitlement(
    {
      policy: version.definition,
      policyVersion: version.version,
      member,
      year,
      unit: leaveType.definition.unit,
      carriedIn,
    },
    ctx,
  );
  return { entries, start, end };
}

/** Post what is due by `on` and missing. Returns the rows posted. */
export async function postEntitlement(
  tx: Tx,
  ctx: EventContext,
  member: Member,
  policy: Policy,
  on: CalendarDate,
  carriedIn: DayAmount | null = null,
): Promise<Result<readonly LedgerEntry[]>> {
  const due = await wanted(tx, ctx, member, policy, on, carriedIn);
  if (due === null) return ok([]);
  const key = due.entries[0]?.leaveTypeKey;
  if (key === undefined) return ok([]);
  const existing = live(await tx.ledger.forMember(member.personId, key));
  const fresh = due.entries.filter(
    (w) => w.effectiveOn <= on && !existing.some((e) => sameSlot(e, w)),
  );
  const posted = await post(tx, fresh);
  if (!posted.ok) return posted;
  await tx.outbox.publish(adjustedEvents(ctx, tx.tenantId, fresh));
  return ok(fresh);
}

/**
 * Re-post the leave year containing `from` under the policy as it now stands
 * and the member as they now are: each grant or accrual on or after `from`
 * that comes out different is superseded by one with the new amount (zero
 * when it is no longer owed), and any newly owed by `on` is posted. Nothing
 * is edited, so the old rows still say what was true when they were written.
 */
export async function refold(
  tx: Tx,
  ctx: EventContext,
  member: Member,
  policy: Policy,
  from: CalendarDate,
  on: CalendarDate,
): Promise<Result<readonly LedgerEntry[]>> {
  const due = await wanted(tx, ctx, member, policy, from, null);
  if (due === null) return ok([]);
  const version = policy.inEffectOn(from);
  const key = version?.definition.leaveTypeKey;
  if (key === undefined) return ok([]);
  const existing = live(await tx.ledger.forMember(member.personId, key)).filter(
    (e) =>
      (e.kind === 'grant' || e.kind === 'accrual') &&
      e.effectiveOn >= from &&
      e.effectiveOn >= due.start &&
      e.effectiveOn <= due.end,
  );
  const corrections = existing.flatMap((e) => {
    const now = due.entries.find((w) => sameSlot(w, e));
    const amount = now?.amount ?? '0.000';
    if (amount === e.amount && now?.policyVersion === e.policyVersion) return [];
    return [
      entry(
        {
          personId: e.personId,
          leaveTypeKey: e.leaveTypeKey,
          unit: e.unit,
          kind: e.kind,
          amount,
          effectiveOn: e.effectiveOn,
          policyVersion: version?.version ?? null,
          supersedes: e.entryId,
        },
        ctx,
      ),
    ];
  });
  const fresh = due.entries.filter(
    (w) =>
      (w.kind === 'grant' || w.kind === 'accrual') &&
      w.effectiveOn >= from &&
      w.effectiveOn <= on &&
      !existing.some((e) => sameSlot(e, w)),
  );
  const posting = [...corrections, ...fresh];
  const posted = await post(tx, posting);
  if (!posted.ok) return posted;
  return ok(posting);
}
