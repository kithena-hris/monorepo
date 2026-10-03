import { ok, type Result } from '@kithena/domain-kit';
import type { LeaveTypeKey, LocationKey, TeamKey } from '@kithena/contracts';

import { DEFAULT_SCHEDULE } from '../attendance/attendance.js';
import { es } from '../../country-packs/es.js';
import { balanceOn } from '../../domain/balance/ledger.js';
import { resolveHolidays } from '../../domain/calendar/holiday-calendar.js';
import { amount, days, sum } from '../../domain/days.js';
import type { LeaveType } from '../../domain/policy/leave-type.js';
import type { PolicyId } from '../../domain/policy/policy.js';
import { previewChange, type PreviewInput } from '../../domain/policy/preview.js';
import { contextFor, userActor, type Caller, type Deps, type Tx } from '../ports.js';
import { applies, forbidden, isHrAdmin, leaveYear, live, notFound, transact } from '../shared.js';
import type {
  ApprovalsSettingsView,
  AttendanceSettingsView,
  HolidaySettingsView,
  LeaveTypeSettingView,
  LeaveTypesView,
  NegativeBalanceView,
  PolicyPreviewView,
} from './views.js';

/**
 * The settings pages (PRD §6, §7.4, §9.1, §10.2, §11.5; T29–T31, T33, T34,
 * T36), HR only, checked here as every settings command checks it.
 */

type ReadDeps = Pick<Deps, 'uow' | 'authz'>;

function asHr<T>(
  deps: ReadDeps,
  caller: Caller,
  fn: (tx: Tx) => Promise<Result<T>>,
): Promise<Result<T>> {
  return transact(deps, caller.tenantId, async (tx) =>
    (await isHrAdmin(deps, caller)) ? fn(tx) : forbidden(),
  );
}

async function row(tx: Tx, t: LeaveType): Promise<LeaveTypesView['leaveTypes'][number]> {
  return {
    definition: t.definition,
    hidden: t.hidden,
    deleted: t.deleted,
    policyIds: (await tx.policies.forLeaveType(t.definition.key)).map((p) => p.id),
  };
}

/**
 * The country packs a tenant's statutory types or holidays came from (§12.3),
 * so settings can say when one is not yet signed off by a lawyer. A pack is in
 * use when one of its statutory types, or one of its holiday layers, is.
 */
const PACKS = [es];
function packsIn(
  leaveTypes: readonly LeaveType[],
  layerKeys: readonly string[],
): LeaveTypesView['packs'] {
  const statutory = new Set(
    leaveTypes.filter((t) => !t.deleted && t.definition.statutory).map((t) => t.definition.key),
  );
  return PACKS.filter(
    (p) =>
      p.leaveTypes.some((t) => statutory.has(t.key)) ||
      p.holidayLayers.some((l) => layerKeys.includes(l.key)),
  ).map((p) => ({ country: p.country, version: p.version, reviewed: p.reviewed }));
}

/** T29: every leave type, hidden ones too; deleted ones are gone. */
export const leaveTypesSettings =
  (deps: ReadDeps) =>
  (caller: Caller): Promise<Result<LeaveTypesView>> =>
    asHr(deps, caller, async (tx) => {
      const all = await tx.leaveTypes.list();
      const rows: LeaveTypesView['leaveTypes'][number][] = [];
      for (const t of all) if (!t.deleted) rows.push(await row(tx, t));
      return ok({ leaveTypes: rows, packs: packsIn(all, []) });
    });

/** T30: one leave type and its policies, every version. */
export const leaveTypeSetting =
  (deps: ReadDeps) =>
  (caller: Caller, query: { readonly key: LeaveTypeKey }): Promise<Result<LeaveTypeSettingView>> =>
    asHr(deps, caller, async (tx) => {
      const t = await tx.leaveTypes.get(query.key);
      if (t === null || t.deleted) return notFound('Leave type');
      return ok({
        leaveType: await row(tx, t),
        policies: (await tx.policies.forLeaveType(query.key)).map((p) => ({
          id: p.id,
          versions: p.versions.map((v) => ({ ...v, definition: v.definition })),
        })),
      });
    });

/**
 * T30: what publishing a policy's draft today would do, member by member: the
 * draft and the version in effect folded side by side over each member either
 * reaches (`previewChange`). Nothing is posted.
 *
 * ponytail: one ledger read per member, fine at a few thousand; one query for
 * the leave type's rows in the year when a tenant outgrows it.
 */
export const policyPreview =
  (deps: ReadDeps & Pick<Deps, 'clock' | 'newId'>) =>
  (caller: Caller, query: { readonly policyId: PolicyId }): Promise<Result<PolicyPreviewView>> =>
    asHr<PolicyPreviewView>(deps, caller, async (tx) => {
      const policy = await tx.policies.get(query.policyId);
      if (policy === null) return notFound('Policy');
      const today = deps.clock.date('UTC');
      const draft = policy.latest.status === 'draft' ? policy.latest : null;
      const current = policy.inEffectOn(today)?.definition ?? null;
      const { year, start, end } = leaveYear(draft?.definition ?? current, today);
      const base = { effectiveFrom: today, yearEnd: end };
      if (draft === null) return ok({ ...base, draftVersion: null, members: [] });
      const key = draft.definition.leaveTypeKey;
      const inputs: PreviewInput[] = [];
      const names = new Map<string, string>();
      for (const m of await tx.members.list()) {
        if (m.status === 'left') continue;
        const now = current !== null && applies(current.appliesTo, m) ? current : null;
        const next = applies(draft.definition.appliesTo, m) ? draft.definition : null;
        if (now === null && next === null) continue;
        const rows = live(await tx.ledger.forMember(m.personId, key)).filter(
          (e) => e.effectiveOn >= start && e.effectiveOn <= end,
        );
        const balance = balanceOn(rows, end);
        names.set(m.personId, m.displayName);
        inputs.push({
          member: m,
          current: now,
          draft: next,
          spent: amount(days(balance.used).plus(balance.booked)),
          carried: amount(
            sum(rows.filter((e) => e.kind === 'carry_over').map((e) => days(e.amount))),
          ),
        });
      }
      const ctx = contextFor(deps, userActor(caller), caller.correlationId, 'UTC');
      return ok({
        ...base,
        draftVersion: draft.version,
        members: previewChange(inputs, year, ctx)
          .map((p) => ({ ...p, displayName: names.get(p.personId) ?? '' }))
          .toSorted((a, b) => a.displayName.localeCompare(b.displayName)),
      });
    });

/** T31: each policy's negative balance rule, as its latest version says. */
export const negativeBalanceSettings =
  (deps: ReadDeps) =>
  (caller: Caller): Promise<Result<NegativeBalanceView>> =>
    asHr(deps, caller, async (tx) => {
      const names = new Map(
        (await tx.leaveTypes.list()).map((t) => [t.definition.key, t.definition.name.default]),
      );
      return ok({
        policies: (await tx.policies.list()).map((p) => ({
          policyId: p.id,
          leaveTypeKey: p.latest.definition.leaveTypeKey,
          leaveTypeName:
            names.get(p.latest.definition.leaveTypeKey) ?? p.latest.definition.leaveTypeKey,
          version: p.latest.version,
          status: p.latest.status,
          rule: p.latest.definition.negativeBalance,
        })),
      });
    });

/** T33: breaks, limits, overtime, and the day a member without a schedule works. */
export const attendanceSettings =
  (deps: ReadDeps) =>
  (caller: Caller): Promise<Result<AttendanceSettingsView>> =>
    asHr(deps, caller, async (tx) =>
      ok({ rules: await tx.attendance.rules(), defaultSchedule: DEFAULT_SCHEDULE }),
    );

/** T34: the approval rules, what is approved automatically, and each team's minimum. */
export const approvalsSettings =
  (deps: ReadDeps) =>
  (caller: Caller): Promise<Result<ApprovalsSettingsView>> =>
    asHr(deps, caller, async (tx) => {
      const teams = new Map<TeamKey, string | null>();
      for (const m of await tx.members.list()) {
        if (m.teamKey !== null && m.status !== 'left') teams.set(m.teamKey, m.teamName);
      }
      const rows: ApprovalsSettingsView['teams'][number][] = [];
      for (const [teamKey, teamName] of teams) {
        rows.push({ teamKey, teamName, minimum: await tx.approvals.teamMinimum(teamKey) });
      }
      return ok({
        rules: (await tx.approvals.rules()).map((r) => ({
          ...r,
          leaveTypes: r.leaveTypes === null ? null : [...r.leaveTypes],
          approvers: [...r.approvers],
        })),
        autoApproval: await tx.approvals.autoApproval(),
        teams: rows.toSorted((a, b) => a.teamKey.localeCompare(b.teamKey)),
      });
    });

/** T36: the calendars, and for each work location the layers it observes and the year they make. */
export const holidaySettings =
  (deps: ReadDeps) =>
  (caller: Caller, query: { readonly year: number }): Promise<Result<HolidaySettingsView>> =>
    asHr(deps, caller, async (tx) => {
      const layers = await tx.holidays.layers();
      const locations = new Set<LocationKey>();
      for (const m of await tx.members.list())
        if (m.locationKey !== null) locations.add(m.locationKey);
      const rows: HolidaySettingsView['locations'][number][] = [];
      for (const locationKey of [...locations].toSorted()) {
        const layerKeys = [...(await tx.holidays.assigned(locationKey))];
        const mine = layerKeys.flatMap((k) => layers.filter((l) => l.key === k));
        rows.push({ locationKey, layerKeys, holidays: resolveHolidays(mine, query.year) });
      }
      return ok({
        year: query.year,
        packs: packsIn(
          await tx.leaveTypes.list(),
          layers.map((l) => l.key),
        ),
        layers: layers.map((l) => ({ ...l, holidays: [...l.holidays] })),
        locations: rows,
      });
    });
