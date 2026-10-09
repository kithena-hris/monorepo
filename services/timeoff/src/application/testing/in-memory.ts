import { fixedClock, type Clock, type PendingEvent } from '@kithena/domain-kit';
import type { CalendarDate, LedgerEntry, PersonId, TenantId } from '@kithena/contracts';

import {
  DEFAULT_AUTO_APPROVAL,
  type ApprovalRule,
  type AutoApproval,
} from '../../domain/approval/approval-rule.js';
import { routeTo, type Delegation } from '../../domain/approval/delegation.js';
import type { Punch } from '../../domain/attendance/clock.js';
import { DEFAULT_RULES, type AttendanceRules } from '../../domain/attendance/day.js';
import type { PayPeriod, TimeLine } from '../../domain/attendance/pay-period.js';
import type { Schedule } from '../../domain/attendance/schedule.js';
import type { HolidayLayer } from '../../domain/calendar/holiday-calendar.js';
import type { TeamMinimum } from '../../domain/coverage/coverage.js';
import type { LeaveType } from '../../domain/policy/leave-type.js';
import type { Policy } from '../../domain/policy/policy.js';
import { pageCursor } from '../shared.js';
import type {
  ApprovalStore,
  ApprovalTimers,
  AttendanceStore,
  Authorizer,
  CompanyParentalWeeks,
  Deps,
  AdjustmentStore,
  FeedStore,
  StoredAdjustment,
  HolidayStore,
  IdempotencyStore,
  Integration,
  IntegrationStore,
  ScimConnection,
  ScimStore,
  ScimUser,
  KioskDevice,
  KioskStore,
  LeaveTypeStore,
  LedgerStore,
  Location,
  LocationStore,
  Member,
  MemberStore,
  Notice,
  Notifier,
  Outbox,
  OvertimeDecision,
  ParentalStore,
  PolicyStore,
  RequestRecord,
  RequestStore,
  Settings,
  StoredKey,
  StoredPlan,
  Tx,
  UnitOfWork,
} from '../ports.js';

/**
 * Every Time Off port, in memory: for application tests that are about a
 * rule rather than about Postgres, and for the standalone suite, which boots
 * the module with no database at all. The integration suite (TOF-034) is
 * what proves the Drizzle adapters.
 */

interface State {
  members: Map<string, Member>;
  locations: Map<string, Location>;
  leaveTypes: Map<string, LeaveType>;
  policies: Map<string, Policy>;
  ledger: LedgerEntry[];
  requests: Map<string, RequestRecord>;
  rules: ApprovalRule[];
  auto: AutoApproval;
  delegations: Map<string, Delegation>;
  minimums: Map<string, TeamMinimum>;
  layers: Map<string, HolidayLayer>;
  assignments: Map<string, readonly string[]>;
  punches: Map<string, Punch[]>;
  schedules: Map<string, Schedule>;
  attendanceRules: AttendanceRules;
  periods: Map<string, PayPeriod>;
  lines: TimeLine[];
  overtime: OvertimeDecision[];
  feeds: Map<string, number>;
  adjustments: Map<string, StoredAdjustment>;
  plans: Map<string, StoredPlan>;
  parentalCompany: CompanyParentalWeeks | null;
  kiosks: Map<string, KioskDevice>;
  /** `${kind}:${hash}` to the member holding it. */
  credentials: Map<string, PersonId>;
  integrations: Map<string, Integration>;
  /** `${provider}:${personId}` to the member's sealed grant. */
  memberSecrets: Map<string, string>;
  scimConnections: Map<string, ScimConnection>;
  scimUsers: Map<string, ScimUser>;
  settings: Map<keyof Settings, Settings[keyof Settings]>;
  events: PendingEvent[];
  keys: Map<string, StoredKey>;
}

const empty = (): State => ({
  members: new Map(),
  locations: new Map(),
  leaveTypes: new Map(),
  policies: new Map(),
  ledger: [],
  requests: new Map(),
  rules: [],
  auto: DEFAULT_AUTO_APPROVAL,
  delegations: new Map(),
  minimums: new Map(),
  layers: new Map(),
  assignments: new Map(),
  punches: new Map(),
  schedules: new Map(),
  attendanceRules: DEFAULT_RULES,
  periods: new Map(),
  lines: [],
  overtime: [],
  feeds: new Map(),
  adjustments: new Map(),
  plans: new Map(),
  parentalCompany: null,
  kiosks: new Map(),
  credentials: new Map(),
  integrations: new Map(),
  memberSecrets: new Map(),
  scimConnections: new Map(),
  scimUsers: new Map(),
  settings: new Map(),
  events: [],
  keys: new Map(),
});

/**
 * A copy to restore on rollback. Collections are copied; the aggregates in
 * them are not, so a use case must refuse before it mutates one.
 *
 * ponytail: an aggregate mutated and then rolled back stays mutated in memory.
 * Postgres reloads it; give the aggregates a snapshot if a test ever needs it.
 */
function snapshot(s: State): State {
  const copy: Record<string, unknown> = { ...s };
  for (const [k, v] of Object.entries(s) as [string, unknown][]) {
    if (v instanceof Map) {
      copy[k] = new Map(
        [...(v as Map<unknown, unknown>)].map(([key, value]) => [
          key,
          Array.isArray(value) ? [...(value as unknown[])] : value,
        ]),
      );
    } else if (Array.isArray(v)) copy[k] = [...(v as unknown[])];
  }
  return copy as unknown as State;
}

type Sync<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => R : never;
};

/** A store written synchronously, answering through promises as the port does. */
function promised<T extends object>(sync: Sync<T>): T {
  return Object.fromEntries(
    Object.entries(sync).map(([k, fn]) => [
      k,
      (...args: unknown[]) => Promise.resolve((fn as (...a: unknown[]) => unknown)(...args)),
    ]),
  ) as T;
}

function stores(tenantId: TenantId, s: State): Tx {
  return {
    tenantId,
    members: promised<MemberStore>({
      get: (id) => s.members.get(id) ?? null,
      list: (filter) =>
        [...s.members.values()].filter(
          (m) => filter?.teamKey === undefined || m.teamKey === filter.teamKey,
        ),
      byAccount: (accountId) => {
        const found = [...s.members.values()].filter((m) => m.accountId === accountId);
        return found.length === 1 ? (found[0] ?? null) : null;
      },
      save: (member) => {
        s.members.set(member.personId, member);
      },
    }),
    locations: promised<LocationStore>({
      get: (key) => s.locations.get(key) ?? null,
      save: (location) => {
        s.locations.set(location.locationKey, location);
      },
    }),
    leaveTypes: promised<LeaveTypeStore>({
      get: (key) => s.leaveTypes.get(key) ?? null,
      list: () => [...s.leaveTypes.values()],
      save: (leaveType) => {
        s.leaveTypes.set(leaveType.id, leaveType);
      },
    }),
    policies: promised<PolicyStore>({
      get: (id) => s.policies.get(id) ?? null,
      forLeaveType: (key) =>
        [...s.policies.values()].filter((p) => p.latest.definition.leaveTypeKey === key),
      list: () => [...s.policies.values()],
      save: (policy) => {
        s.policies.set(policy.id, policy);
      },
    }),
    ledger: promised<LedgerStore>({
      forMember: (personId, key) =>
        s.ledger.filter(
          (e) => e.personId === personId && (key === undefined || e.leaveTypeKey === key),
        ),
      forMembers: (personIds, key) =>
        s.ledger.filter(
          (e) => personIds.includes(e.personId) && (key === undefined || e.leaveTypeKey === key),
        ),
      append: (entries) => {
        s.ledger.push(...entries);
      },
    }),
    requests: promised<RequestStore>({
      get: (id) => s.requests.get(id) ?? null,
      list: (f) =>
        [...s.requests.values()].filter(
          ({ request: r }) =>
            (f.personIds === undefined || f.personIds.includes(r.personId)) &&
            (f.statuses === undefined || f.statuses.includes(r.status)) &&
            (f.from === undefined || r.span.to >= f.from) &&
            (f.to === undefined || r.span.from <= f.to),
        ),
      page: (f) => {
        const keyOf = (r: RequestRecord): string =>
          f.order === 'newest' ? r.requestedAt : r.request.span.from;
        const sign = f.order === 'newest' ? -1 : 1;
        const after = pageCursor.read(f.after);
        const rows = [...s.requests.values()]
          .filter(
            ({ request: r }) =>
              (f.personIds === undefined || f.personIds.includes(r.personId)) &&
              f.statuses.includes(r.status) &&
              (f.from === undefined || r.span.to >= f.from),
          )
          .filter((r) => {
            if (after === null) return true;
            const c = keyOf(r).localeCompare(after.key) || r.request.id.localeCompare(after.id);
            return sign * c > 0;
          })
          .toSorted(
            (a, b) =>
              sign * (keyOf(a).localeCompare(keyOf(b)) || a.request.id.localeCompare(b.request.id)),
          );
        const records = rows.slice(0, f.limit);
        const last = records.at(-1);
        return {
          records,
          next:
            rows.length > f.limit && last !== undefined
              ? pageCursor.of(keyOf(last), last.request.id)
              : null,
        };
      },
      save: (record) => {
        s.requests.set(record.request.id, record);
      },
    }),
    approvals: promised<ApprovalStore>({
      rules: () => s.rules,
      setRules: (rules) => {
        s.rules = [...rules];
      },
      autoApproval: () => s.auto,
      setAutoApproval: (auto) => {
        s.auto = auto;
      },
      delegation: (approverId) => s.delegations.get(approverId) ?? null,
      saveDelegation: (d) => {
        s.delegations.set(d.approverId, d);
      },
      removeDelegation: (approverId) => {
        s.delegations.delete(approverId);
      },
      teamMinimum: (teamKey) => s.minimums.get(teamKey) ?? null,
      setTeamMinimum: (teamKey, minimum) => {
        if (minimum === null) s.minimums.delete(teamKey);
        else s.minimums.set(teamKey, minimum);
      },
    }),
    holidays: promised<HolidayStore>({
      layers: () => [...s.layers.values()],
      saveLayer: (layer) => {
        s.layers.set(layer.key, layer);
      },
      removeLayer: (key) => {
        s.layers.delete(key);
      },
      assigned: (locationKey) => s.assignments.get(locationKey) ?? [],
      assign: (locationKey, keys) => {
        s.assignments.set(locationKey, [...keys]);
      },
    }),
    attendance: promised<AttendanceStore>({
      punches: (personId) => s.punches.get(personId) ?? [],
      punchesOf: (personIds) => new Map(personIds.map((id) => [id, s.punches.get(id) ?? []])),
      appendPunch: (personId, punch) => {
        s.punches.set(personId, [...(s.punches.get(personId) ?? []), punch]);
      },
      schedule: (personId) => s.schedules.get(personId) ?? null,
      schedulesOf: (personIds) =>
        new Map(
          personIds.flatMap((id) => {
            const held = s.schedules.get(id);
            return held === undefined ? [] : [[id, held] as const];
          }),
        ),
      setSchedule: (personId, schedule) => {
        s.schedules.set(personId, schedule);
      },
      rules: () => s.attendanceRules,
      setRules: (rules) => {
        s.attendanceRules = rules;
      },
      periods: () => [...s.periods.values()],
      savePeriod: (period) => {
        s.periods.set(period.id, period);
      },
      lines: () => s.lines,
      appendLine: (line) => {
        s.lines.push(line);
      },
      overtime: (personId) => s.overtime.filter((o) => o.personId === personId),
      decideOvertime: (decision) => {
        s.overtime.push(decision);
      },
    }),
    adjustments: promised<AdjustmentStore>({
      get: (id) => s.adjustments.get(id) ?? null,
      save: (a) => {
        s.adjustments.set(a.adjustmentId, a);
      },
      list: ({ status, since }) =>
        [...s.adjustments.values()]
          .filter(
            (a) =>
              (status === undefined || a.status === status) &&
              (since === undefined || (a.decidedAt ?? a.proposedAt) >= since),
          )
          .sort((a, b) => b.proposedAt.localeCompare(a.proposedAt)),
    }),
    feeds: promised<FeedStore>({
      version: (personId) => s.feeds.get(personId) ?? 0,
      bump: (personId) => {
        const next = (s.feeds.get(personId) ?? 0) + 1;
        s.feeds.set(personId, next);
        return next;
      },
    }),
    parental: promised<ParentalStore>({
      get: (id) => s.plans.get(id) ?? null,
      list: (f) =>
        [...s.plans.values()]
          .filter(
            (p) =>
              (f.personId === undefined || p.personId === f.personId) &&
              (f.statuses === undefined || f.statuses.includes(p.status)),
          )
          .toSorted((a, b) => b.id.localeCompare(a.id)),
      save: (plan) => {
        s.plans.set(plan.id, plan);
      },
      company: () => s.parentalCompany,
      setCompany: (weeks) => {
        s.parentalCompany = weeks;
      },
    }),
    kiosks: promised<KioskStore>({
      device: (id) => s.kiosks.get(id) ?? null,
      devices: () => [...s.kiosks.values()],
      saveDevice: (device) => {
        s.kiosks.set(device.id, device);
      },
      holder: (kind, hash) => s.credentials.get(`${kind}:${hash}`) ?? null,
      setCredential: (personId, kind, hash) => {
        for (const [key, holder] of s.credentials)
          if (holder === personId && key.startsWith(`${kind}:`)) s.credentials.delete(key);
        if (hash === null) return;
        // The partial unique index's refusal, as Postgres would raise it.
        if (s.credentials.has(`${kind}:${hash}`)) throw new Error('kiosk_credential unique');
        s.credentials.set(`${kind}:${hash}`, personId);
      },
    }),
    integrations: promised<IntegrationStore>({
      list: () => [...s.integrations.values()],
      get: (provider) => s.integrations.get(provider) ?? null,
      save: (integration) => {
        s.integrations.set(integration.provider, integration);
      },
      remove: (provider) => {
        s.integrations.delete(provider);
        for (const key of s.memberSecrets.keys())
          if (key.startsWith(`${provider}:`)) s.memberSecrets.delete(key);
      },
      memberSecret: (provider, personId) => s.memberSecrets.get(`${provider}:${personId}`) ?? null,
      setMemberSecret: (provider, personId, sealed) => {
        if (sealed === null) s.memberSecrets.delete(`${provider}:${personId}`);
        else s.memberSecrets.set(`${provider}:${personId}`, sealed);
      },
    }),
    scim: promised<ScimStore>({
      connection: (id) => s.scimConnections.get(id) ?? null,
      saveConnection: (connection) => {
        s.scimConnections.set(connection.id, connection);
      },
      user: (personId) => s.scimUsers.get(personId) ?? null,
      byUserName: (userName) =>
        [...s.scimUsers.values()].find(
          (u) => u.userName.toLowerCase() === userName.toLowerCase(),
        ) ?? null,
      users: () => [...s.scimUsers.values()],
      saveUser: (user) => {
        // The unique index's refusal, as Postgres would raise it.
        const clash = [...s.scimUsers.values()].find(
          (u) =>
            u.personId !== user.personId &&
            u.userName.toLowerCase() === user.userName.toLowerCase(),
        );
        if (clash !== undefined) throw new Error('scim_user_user_name_key');
        s.scimUsers.set(user.personId, user);
      },
    }),
    settings: {
      get: (key) => Promise.resolve((s.settings.get(key) ?? null) as never),
      set: (key, value) => {
        s.settings.set(key, value);
        return Promise.resolve();
      },
    },
    outbox: promised<Outbox>({
      publish: (events) => {
        s.events.push(...events);
      },
    }),
    idempotency: promised<IdempotencyStore>({
      find: (key) => s.keys.get(key) ?? null,
      save: (key, stored) => {
        if (s.keys.has(key)) return false;
        s.keys.set(key, stored);
        return true;
      },
    }),
  };
}

/** A clock a test can move. */
export function movableClock(at: string): Clock & { set(at: string): void } {
  let current = fixedClock(at);
  return {
    now: () => current.now(),
    today: (tz) => current.today(tz),
    instant: () => current.instant(),
    date: (tz) => current.date(tz),
    set(next) {
      current = fixedClock(next);
    },
  };
}

/** Deterministic UUIDv7-shaped ids, so an assertion never depends on entropy. */
export function sequentialIds(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `01890000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
  };
}

export interface InMemoryTimeOff {
  readonly deps: Deps;
  readonly clock: Clock & { set(at: string): void };
  /** One tenant's state, for assertions and seeding. */
  state(tenantId: TenantId): State;
  /** Accounts holding `hr_admin`. */
  readonly hrAccounts: Set<string>;
  readonly notices: { tenantId: TenantId; to: PersonId | 'hr'; notice: Notice; key: string }[];
  readonly timers: { started: string[]; closed: string[] };
}

export function inMemoryTimeOff(at = '2026-10-01T07:00:00.000Z'): InMemoryTimeOff {
  const tenants = new Map<TenantId, State>();
  const state = (tenantId: TenantId): State => {
    let s = tenants.get(tenantId);
    if (s === undefined) {
      s = empty();
      tenants.set(tenantId, s);
    }
    return s;
  };
  const clock = movableClock(at);

  const uow: UnitOfWork = {
    async run(tenantId, fn) {
      const before = snapshot(state(tenantId));
      try {
        return await fn(stores(tenantId, state(tenantId)));
      } catch (error) {
        Object.assign(state(tenantId), before);
        throw error;
      }
    },
  };

  const hrAccounts = new Set<string>();
  const check: Sync<Authorizer>['check'] = (tenantId, { user, relation, object }) => {
    const s = state(tenantId);
    if (relation === 'hr_admin') {
      return user.startsWith('account:') && hrAccounts.has(user.slice('account:'.length));
    }
    const person = user.startsWith('person:') ? user.slice('person:'.length) : null;
    const member = s.members.get(object.slice('member:'.length));
    if (person === null || member === undefined) return false;
    switch (relation) {
      case 'approver':
        return member.managerPersonId === person;
      case 'teammate':
        return (
          member.teamKey !== null &&
          member.personId !== person &&
          s.members.get(person)?.teamKey === member.teamKey
        );
      case 'delegate': {
        const approverId = member.managerPersonId;
        if (approverId === null) return false;
        const approver = s.members.get(approverId);
        const on: CalendarDate = clock.date(approver?.timeZone ?? member.timeZone);
        const away = [...s.requests.values()]
          .filter((r) => r.request.personId === approverId && r.request.status === 'approved')
          .flatMap((r) => r.request.spans);
        const route = routeTo({
          approverId,
          on,
          delegation: s.delegations.get(approverId) ?? null,
          approverAway: away,
          salaryRelated: false,
        });
        return route.kind === 'delegate' && route.personId === person;
      }
    }
  };
  const authz: Authorizer = promised<Authorizer>({
    check,
    members: (tenantId, user, relation) =>
      [...state(tenantId).members.keys()].filter((id) =>
        check(tenantId, { user, relation, object: `member:${id}` }),
      ),
  });

  const notices: InMemoryTimeOff['notices'] = [];
  const sent = new Set<string>();
  const notifier = promised<Notifier>({
    notify(tenantId, to, notice, key) {
      if (sent.has(key)) return;
      sent.add(key);
      notices.push({ tenantId, to, notice, key });
    },
  });

  const timerLog = { started: [] as string[], closed: [] as string[] };
  const timers = promised<ApprovalTimers>({
    started(_tenantId, requestId) {
      timerLog.started.push(requestId);
    },
    closed(_tenantId, requestId) {
      timerLog.closed.push(requestId);
    },
  });

  return {
    deps: {
      uow,
      authz,
      clock,
      newId: sequentialIds(),
      timers,
      notifier,
      feedSecret: 'in-memory feed secret',
    },
    clock,
    state,
    hrAccounts,
    notices,
    timers: timerLog,
  };
}
