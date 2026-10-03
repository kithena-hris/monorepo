import { err, Conflict, ok, type Result } from '@kithena/domain-kit';
import {
  PolicyDefinition,
  type CalendarDate,
  type LeaveTypeDefinition,
  type LeaveTypeKey,
  type LocationKey,
  type NegativeBalanceRule,
  type PersonId,
  type TeamKey,
} from '@kithena/contracts';

import type { ApprovalRule, AutoApproval } from '../../domain/approval/approval-rule.js';
import type { AttendanceRules } from '../../domain/attendance/day.js';
import type { Schedule } from '../../domain/attendance/schedule.js';
import type { HolidayLayer } from '../../domain/calendar/holiday-calendar.js';
import type { TeamMinimum } from '../../domain/coverage/coverage.js';
import { LeaveType, type LeaveTypeInput } from '../../domain/policy/leave-type.js';
import { Policy, policyId, type PolicyId } from '../../domain/policy/policy.js';
import { addDays, addMonths } from '../../domain/days.js';
import { refold } from '../entitlement.js';
import {
  contextFor,
  userActor,
  type Caller,
  type Deps,
  type PolicyShadow,
  type Tx,
} from '../ports.js';
import { applies, forbidden, isHrAdmin, notFound, refuse, transact } from '../shared.js';

/**
 * Settings (PRD §6, §7.4, §9.1, §9.3, §10.2, §11.5; TOF-041): leave types,
 * policies, holiday calendars, approval rules, team minimums, negative
 * balance rules and attendance rules. `hr_admin` only, checked here.
 *
 * Publishing a policy re-folds every affected balance from the version's
 * effective date and raises `timeoff.policy.published` in the same
 * transaction, so no screen ever shows a balance from the old rules beside a
 * policy that says the new ones.
 */

type AdminDeps = Pick<Deps, 'uow' | 'authz'>;

/** A transaction that only HR gets into. */
function asHr<T>(
  deps: AdminDeps,
  caller: Caller,
  fn: (tx: Tx) => Promise<Result<T>>,
): Promise<Result<T>> {
  return transact(deps, caller.tenantId, async (tx) =>
    (await isHrAdmin(deps, caller)) ? fn(tx) : forbidden(),
  );
}

/* ----------------------------------------------------------- leave types -- */

export const defineLeaveType =
  (deps: AdminDeps) =>
  (caller: Caller, input: LeaveTypeInput): Promise<Result<LeaveTypeKey>> =>
    asHr(deps, caller, async (tx) => {
      if ((await tx.leaveTypes.get(input.key)) !== null) {
        return err(Conflict(`A leave type called ${input.key} already exists`));
      }
      const defined = LeaveType.define(input);
      if (!defined.ok) return defined;
      await tx.leaveTypes.save(defined.value);
      return ok(input.key);
    });

/** Change, hide, show or delete one. The key never changes; a statutory type is only hidden. */
export const changeLeaveType =
  (deps: AdminDeps) =>
  (
    caller: Caller,
    key: LeaveTypeKey,
    change:
      | { readonly kind: 'update'; readonly changes: Partial<LeaveTypeDefinition> }
      | { readonly kind: 'hide' | 'show' | 'delete' },
  ): Promise<Result<void>> =>
    asHr(deps, caller, async (tx) => {
      const leaveType = await tx.leaveTypes.get(key);
      if (leaveType === null) return notFound('Leave type');
      let done: Result<void> = ok(undefined);
      if (change.kind === 'update') done = leaveType.update(change.changes);
      else if (change.kind === 'delete') done = leaveType.delete();
      else if (change.kind === 'hide') leaveType.hide();
      else leaveType.show();
      if (!done.ok) return done;
      await tx.leaveTypes.save(leaveType);
      return ok(undefined);
    });

/* -------------------------------------------------------------- policies -- */

export const draftPolicy =
  (deps: AdminDeps & Pick<Deps, 'newId'>) =>
  (caller: Caller, input: unknown): Promise<Result<PolicyId>> =>
    asHr(deps, caller, async (tx) => {
      const definition = PolicyDefinition.safeParse(input);
      if (!definition.success) {
        return refuse('INVALID', definition.error.issues[0]?.message ?? 'Invalid policy');
      }
      if ((await tx.leaveTypes.get(definition.data.leaveTypeKey)) === null) {
        return notFound('Leave type');
      }
      const policy = Policy.draft({
        id: policyId(deps.newId()),
        tenantId: caller.tenantId,
        definition: definition.data,
      });
      await tx.policies.save(policy);
      return ok(policy.id);
    });

/** Replace the draft, or start the next version's when the latest is published. */
export const revisePolicy =
  (deps: AdminDeps) =>
  (caller: Caller, id: PolicyId, input: unknown): Promise<Result<number>> =>
    asHr(deps, caller, async (tx) => {
      const definition = PolicyDefinition.safeParse(input);
      if (!definition.success) {
        return refuse('INVALID', definition.error.issues[0]?.message ?? 'Invalid policy');
      }
      const policy = await tx.policies.get(id);
      if (policy === null) return notFound('Policy');
      const revised = policy.revise(definition.data);
      if (!revised.ok) return revised;
      await tx.policies.save(policy);
      return ok(policy.latest.version);
    });

/** The negative balance rule (§7.4, T31) is part of the policy: a revision, published like any other. */
export const setNegativeBalanceRule =
  (deps: AdminDeps) =>
  (caller: Caller, id: PolicyId, rule: NegativeBalanceRule | null): Promise<Result<number>> =>
    asHr(deps, caller, async (tx) => {
      const policy = await tx.policies.get(id);
      if (policy === null) return notFound('Policy');
      const revised = policy.revise({ ...policy.latest.definition, negativeBalance: rule });
      if (!revised.ok) return revised;
      await tx.policies.save(policy);
      return ok(policy.latest.version);
    });

/**
 * Publish the draft from a date (§6.3): the version is fixed from then on,
 * every member it applies to is re-folded from that date, and
 * `timeoff.policy.published` goes out with the corrections.
 */
export const publishPolicy =
  (deps: AdminDeps & Pick<Deps, 'clock' | 'newId'>) =>
  (
    caller: Caller,
    id: PolicyId,
    effectiveFrom: CalendarDate,
  ): Promise<Result<{ version: number; refolded: number }>> =>
    asHr(deps, caller, async (tx) => {
      const policy = await tx.policies.get(id);
      if (policy === null) return notFound('Policy');
      const ctx = contextFor(deps, userActor(caller), caller.correlationId, 'UTC');
      const published = policy.publish(effectiveFrom, ctx);
      if (!published.ok) return published;
      await tx.policies.save(policy);
      await tx.outbox.publish(policy.drainEvents());

      let refolded = 0;
      const definition = policy.latest.definition;
      for (const member of await tx.members.list()) {
        if (member.status === 'left' || !applies(definition.appliesTo, member)) continue;
        const memberCtx = contextFor(
          deps,
          userActor(caller),
          caller.correlationId,
          member.timeZone,
        );
        const today = deps.clock.date(member.timeZone);
        const done = await refold(tx, memberCtx, member, policy, effectiveFrom, today);
        if (!done.ok) return done;
        refolded += done.value.length;
      }
      // Published, the draft is the policy: there is nothing left to run beside it.
      await setShadow(tx, id, null);
      return ok({ version: policy.latest.version, refolded });
    });

async function setShadow(tx: Tx, id: PolicyId, shadow: PolicyShadow | null): Promise<void> {
  const { [id]: _was, ...rest } = (await tx.settings.get('policy_shadows')) ?? {};
  await tx.settings.set('policy_shadows', shadow === null ? rest : { ...rest, [id]: shadow });
}

/**
 * A shadow run (§6.3, TOF-093): the draft runs beside the version in effect
 * for a month from today, so HR can compare balances day by day before
 * publishing. Nothing is posted; only HR's settings read it.
 */
export const startShadowRun =
  (deps: AdminDeps & Pick<Deps, 'clock'>) =>
  (caller: Caller, id: PolicyId): Promise<Result<PolicyShadow>> =>
    asHr(deps, caller, async (tx) => {
      const policy = await tx.policies.get(id);
      if (policy === null) return notFound('Policy');
      if (policy.latest.status !== 'draft') {
        return refuse('NO_DRAFT', 'Only a draft can run beside the policy in effect');
      }
      const from = deps.clock.date('UTC');
      const shadow = { from, to: addDays(addMonths(from, 1), -1) };
      await setShadow(tx, id, shadow);
      return ok(shadow);
    });

export const stopShadowRun =
  (deps: AdminDeps) =>
  (caller: Caller, id: PolicyId): Promise<Result<void>> =>
    asHr(deps, caller, async (tx) => {
      await setShadow(tx, id, null);
      return ok(undefined);
    });

/* ------------------------------------------------------------- calendars -- */

export const saveHolidayCalendar =
  (deps: AdminDeps) =>
  (caller: Caller, layer: HolidayLayer): Promise<Result<void>> =>
    asHr(deps, caller, async (tx) => {
      if (new Set(layer.holidays.map((h) => h.date)).size !== layer.holidays.length) {
        return refuse('DUPLICATE_DAY', 'A calendar lists each day once', ['holidays']);
      }
      await tx.holidays.saveLayer(layer);
      return ok(undefined);
    });

export const removeHolidayCalendar =
  (deps: AdminDeps) =>
  (caller: Caller, key: string): Promise<Result<void>> =>
    asHr(deps, caller, async (tx) => {
      await tx.holidays.removeLayer(key);
      return ok(undefined);
    });

/** Which layers a work location observes, most general first (Madrid: Spain, the region, the city). */
export const assignHolidayCalendars =
  (deps: AdminDeps) =>
  (caller: Caller, locationKey: LocationKey, layerKeys: readonly string[]): Promise<Result<void>> =>
    asHr(deps, caller, async (tx) => {
      const known = new Set((await tx.holidays.layers()).map((l) => l.key));
      const missing = layerKeys.find((k) => !known.has(k));
      if (missing !== undefined) return notFound(`Holiday calendar ${missing}`);
      await tx.holidays.assign(locationKey, layerKeys);
      return ok(undefined);
    });

/* ----------------------------------------------------- approvals, teams -- */

export const setApprovalRules =
  (deps: AdminDeps) =>
  (caller: Caller, rules: readonly ApprovalRule[], auto?: AutoApproval): Promise<Result<void>> =>
    asHr(deps, caller, async (tx) => {
      if (rules.some((r) => r.leaveTypes !== null && r.leaveTypes.length === 0)) {
        return refuse('EMPTY_RULE', 'A rule names at least one leave type, or all of them', [
          'rules',
        ]);
      }
      await tx.approvals.setRules(rules);
      if (auto !== undefined) await tx.approvals.setAutoApproval(auto);
      return ok(undefined);
    });

export const setTeamMinimum =
  (deps: AdminDeps) =>
  (caller: Caller, teamKey: TeamKey, minimum: TeamMinimum | null): Promise<Result<void>> =>
    asHr(deps, caller, async (tx) => {
      if (
        minimum !== null &&
        (!Number.isInteger(minimum.atLeast) ||
          minimum.atLeast < 1 ||
          (minimum.unit === 'percent' && minimum.atLeast > 100))
      ) {
        return refuse('INVALID_MINIMUM', 'At least one person, or a percentage up to 100', [
          'atLeast',
        ]);
      }
      await tx.approvals.setTeamMinimum(teamKey, minimum);
      return ok(undefined);
    });

/* ------------------------------------------------------------ attendance -- */

export const setAttendanceRules =
  (deps: AdminDeps) =>
  (caller: Caller, rules: AttendanceRules): Promise<Result<void>> =>
    asHr(deps, caller, async (tx) => {
      const minutes = [
        rules.breakAfterMinutes,
        rules.breakMinutes,
        rules.restMinutes,
        rules.weeklyMaxMinutes,
      ];
      if (minutes.some((m) => !Number.isInteger(m) || m < 0)) {
        return refuse('INVALID_RULES', 'Durations are whole minutes, none negative');
      }
      await tx.attendance.setRules(rules);
      return ok(undefined);
    });

export const assignSchedule =
  (deps: AdminDeps) =>
  (caller: Caller, personIds: readonly PersonId[], schedule: Schedule): Promise<Result<void>> =>
    asHr(deps, caller, async (tx) => {
      for (const personId of personIds) {
        if ((await tx.members.get(personId)) === null) return notFound('Member');
        await tx.attendance.setSchedule(personId, schedule);
      }
      return ok(undefined);
    });
