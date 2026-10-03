import { ok, type Result } from '@kithena/domain-kit';
import type { LeaveTypeKey, LocationKey, TeamKey } from '@kithena/contracts';

import { DEFAULT_SCHEDULE } from '../attendance/attendance.js';
import { resolveHolidays } from '../../domain/calendar/holiday-calendar.js';
import type { LeaveType } from '../../domain/policy/leave-type.js';
import type { Caller, Deps, Tx } from '../ports.js';
import { forbidden, isHrAdmin, notFound, transact } from '../shared.js';
import type {
  ApprovalsSettingsView,
  AttendanceSettingsView,
  HolidaySettingsView,
  LeaveTypeSettingView,
  LeaveTypesView,
  NegativeBalanceView,
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

/** T29: every leave type, hidden ones too; deleted ones are gone. */
export const leaveTypesSettings =
  (deps: ReadDeps) =>
  (caller: Caller): Promise<Result<LeaveTypesView>> =>
    asHr(deps, caller, async (tx) => {
      const rows: LeaveTypesView['leaveTypes'][number][] = [];
      for (const t of await tx.leaveTypes.list()) if (!t.deleted) rows.push(await row(tx, t));
      return ok({ leaveTypes: rows });
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
        layers: layers.map((l) => ({ ...l, holidays: [...l.holidays] })),
        locations: rows,
      });
    });
