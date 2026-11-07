import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { CalendarDate, DateSpan, LeaveTypeKey, TenantId } from '@kithena/contracts';
import { fixedClock, systemClock } from '@kithena/domain-kit';
import { withTenant } from '@kithena/db-kit';
import { logger } from '@kithena/telemetry';

import {
  assignHolidayCalendars,
  defineLeaveType,
  draftPolicy,
  publishPolicy,
  saveHolidayCalendar,
} from '../application/admin/admin.js';
import { decideRequest } from '../application/approval/decide.js';
import { markTakenDue } from '../application/jobs.js';
import { refold } from '../application/entitlement.js';
import { contextFor, systemActor } from '../application/ports.js';
import type { Authorizer, Caller, Deps, Member } from '../application/ports.js';
import { policyFor } from '../application/shared.js';
import { sendRequest } from '../application/request/request.js';
import { resolveHolidays } from '../domain/calendar/holiday-calendar.js';
import { addDays, weekday } from '../domain/calendar/working-days.js';
import { timeoffFgaFrom } from '../infrastructure/openfga.js';
import { punch } from '../infrastructure/tables.js';
import { drizzleUnitOfWork, uuidv7 } from '../infrastructure/unit-of-work.js';
import {
  ALLOWANCE,
  CALENDARS,
  calendarsFor,
  instantIn,
  planDay,
  planLeave,
  stream,
} from './year.js';

/**
 * A seeded company's year in Time Off (`node dist/src/seed/seed-year.js`):
 * every office's holiday calendars, annual and sick leave with an allowance
 * by country, each member's time off through the same requests and
 * decisions a person makes, and every working day clocked from the first of
 * January (or their first day) to yesterday.
 *
 * `TENANT_ID` names the company; `SUPER_ADMIN_EMAILS` the members whose
 * account is its super administrator, written to the graph as identity would
 * on naming People's administrator. Run again, it adds what is missing:
 * leave types, calendars and policies once, time off and punches for whoever
 * has none yet.
 *
 * Demo data, by a script, as Time Off's own service account: the requests
 * and decisions go through the application, and only the punches are
 * written in bulk, because four million of them one request at a time would
 * take a day.
 */

const tenantId = TenantId.parse(process.env['TENANT_ID']);
const url = process.env['TIMEOFF_DATABASE_URL'];
if (url === undefined || url === '') throw new Error('TIMEOFF_DATABASE_URL is not set');
/** Who the seed acts as: no member, so nothing is ever theirs. */
const SEED_ACCOUNT = '00000000-0000-4000-8000-00000000a5ed';
const CORRELATION = '00000000-0000-4000-8000-00000000a5ee';

const client = postgres(url, { max: 6 });
const db = drizzle(client);
const uow = drizzleUnitOfWork(db);

/** The script decides as the people it seeds: it is let do what each of them could. */
const allow: Authorizer = {
  check: (_tenant, { relation }) => Promise.resolve(relation !== 'super_admin'),
  members: () => Promise.resolve([]),
};

const depsAt = (at: string): Deps => ({
  uow,
  authz: allow,
  clock: fixedClock(at),
  newId: uuidv7,
  timers: { started: () => Promise.resolve(), closed: () => Promise.resolve() },
  notifier: { notify: () => Promise.resolve() },
  feedSecret: 'seed',
});

const hr: Caller = {
  tenantId,
  accountId: SEED_ACCOUNT,
  personId: null,
  correlationId: CORRELATION,
};
const as = (m: Member): Caller => ({
  tenantId,
  accountId: m.accountId ?? SEED_ACCOUNT,
  personId: m.personId,
  correlationId: CORRELATION,
});

const vacation = LeaveTypeKey.parse('vacation');
const sick = LeaveTypeKey.parse('sick');
const now = systemClock.instant();

/** In pools of `size`, so the database is kept busy and never swamped. */
async function inPools<T>(items: readonly T[], size: number, fn: (x: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

async function leaveTypesAndPolicies(): Promise<void> {
  const deps = depsAt(now);
  const types = await uow.run(tenantId, (tx) => tx.leaveTypes.list());
  const have = new Set(types.map((t) => t.definition.key as string));
  if (!have.has(vacation)) {
    const made = await defineLeaveType(deps)(hr, {
      key: vacation,
      name: { default: 'Annual leave' },
      category: 'annual_leave',
      colorToken: 'chart-1',
      icon: 'sun',
      tracked: true,
      paid: 'paid',
      visibility: 'type',
    } as never);
    if (!made.ok) throw new Error(made.error.message);
  }
  if (!have.has(sick)) {
    const made = await defineLeaveType(deps)(hr, {
      key: sick,
      name: { default: 'Sick leave' },
      category: 'sick_leave',
      colorToken: 'chart-3',
      icon: 'thermometer',
      tracked: false,
      paid: 'paid',
      visibility: 'off_only',
      requiresNote: { afterDays: 3 },
    } as never);
    if (!made.ok) throw new Error(made.error.message);
  }
  const policies = await uow.run(tenantId, (tx) => tx.policies.forLeaveType(vacation));
  if (policies.length > 0) return;
  for (const [country, allowance] of Object.entries(ALLOWANCE)) {
    const drafted = await draftPolicy(deps)(hr, {
      leaveTypeKey: vacation,
      allowance: [{ fromYears: 0, days: `${String(allowance)}.000` }],
      carryOver: { maxDays: '5.000', useBy: { month: 3, day: 31 } },
      negativeBalance: { limit: '3.000' },
      appliesTo: { combine: 'all', clauses: [{ operand: 'country', in: [country] }] },
    });
    if (!drafted.ok) throw new Error(drafted.error.message);
    const published = await publishPolicy(deps)(
      hr,
      drafted.value,
      CalendarDate.parse('2026-01-01'),
    );
    if (!published.ok) throw new Error(published.error.message);
    logger.info({ country, refolded: published.value.refolded }, 'annual leave published');
  }
}

/** Every calendar, and each office's; returns each location's holidays in 2026. */
async function calendars(members: readonly Member[]): Promise<Map<string, Set<string>>> {
  const deps = depsAt(now);
  const saved = new Set((await uow.run(tenantId, (tx) => tx.holidays.layers())).map((l) => l.key));
  for (const layer of CALENDARS) {
    if (saved.has(layer.key)) continue;
    const done = await saveHolidayCalendar(deps)(hr, layer);
    if (!done.ok) throw new Error(done.error.message);
  }
  const byLocation = new Map<string, Set<string>>();
  const keys = [
    ...new Set(members.flatMap((m) => (m.locationKey === null ? [] : [m.locationKey]))),
  ];
  for (const key of keys) {
    const location = await uow.run(tenantId, (tx) => tx.locations.get(key));
    const country =
      location?.country ?? members.find((m) => m.locationKey === key)?.country ?? null;
    const chosen = calendarsFor(country, location?.name ?? '');
    const assigned = await uow.run(tenantId, (tx) => tx.holidays.assigned(key));
    if (assigned.length === 0 && chosen.length > 0) {
      const done = await assignHolidayCalendars(deps)(hr, key, chosen);
      if (!done.ok) throw new Error(done.error.message);
    }
    const layers = CALENDARS.filter((l) =>
      (assigned.length > 0 ? assigned : chosen).includes(l.key),
    );
    byLocation.set(key, new Set(resolveHolidays(layers, 2026).map((h) => h.date)));
    logger.info({ location: location?.name ?? key, calendars: chosen }, 'holidays assigned');
  }
  return byLocation;
}

/** One member's time off, requested ahead of each block and decided by their approver. */
async function leaveOf(
  m: Member,
  holidays: ReadonlySet<string>,
  approver: Member | null,
): Promise<{ sent: number; refused: number }> {
  const today = systemClock.date(m.timeZone);
  const already = await uow.run(tenantId, (tx) => tx.requests.list({ personIds: [m.personId] }));
  // Annual leave decides it: a run before the member had a country booked only their sick days.
  const booked = already.some(
    (r) => r.request.leaveType.key === vacation && r.request.span.from >= '2026-01-01',
  );
  if (booked) return { sent: 0, refused: 0 };
  // Placed after the policies were published: the year's allowance, as a move now posts it.
  await uow.run(tenantId, async (tx) => {
    const policy = await policyFor(tx, m, vacation, today);
    if (policy === null) return;
    const ctx = contextFor(depsAt(now), systemActor('timeoff-seed'), CORRELATION, m.timeZone);
    await refold(tx, ctx, m, policy.policy, today, today);
  });
  const allowance = ALLOWANCE[m.country ?? ''] ?? 20;
  const plan = planLeave({
    personId: m.personId,
    allowance,
    start: m.hireDate,
    today,
    yearEnd: CalendarDate.parse('2026-12-31'),
    holidays,
  });
  const rand = stream(`asked:${m.personId}`);
  let sent = 0;
  let refused = 0;
  for (const leave of plan) {
    // Asked a week to a month ahead (a sick day, the morning of it); decided the next day.
    const ahead = leave.kind === 'sick' ? 0 : 7 + Math.floor(rand() * 24);
    const asked = `${addDays(leave.from, -ahead)}T08:${String(10 + Math.floor(rand() * 40))}:00.000Z`;
    const askedAt = asked < now ? asked : now;
    const request = await sendRequest(depsAt(askedAt))(as(m), {
      leaveTypeKey: leave.kind === 'sick' ? sick : vacation,
      span: DateSpan.parse({ from: leave.from, to: leave.to }),
    });
    if (!request.ok) {
      refused += 1;
      continue;
    }
    sent += 1;
    if (request.value.status !== 'pending' || leave.pending) continue;
    const decidedAt = new Date(
      Math.min(Date.parse(askedAt) + 26 * 3_600_000, Date.parse(now)),
    ).toISOString();
    const decider = approver === null ? hr : as(approver);
    // A chain of more than one step: each decides in turn.
    for (let step = 0; step < 3; step += 1) {
      const decided = await decideRequest(depsAt(decidedAt))(decider, {
        requestId: request.value.requestId,
        decision: 'approve',
      });
      if (!decided.ok || decided.value.next === null) break;
    }
  }
  return { sent, refused };
}

/** Every working day clocked, from their first day or the year's, to yesterday. */
async function punchesOf(
  members: readonly Member[],
  holidaysAt: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<number> {
  let written = 0;
  await inPools(members, 4, async (m) => {
    const yesterday = addDays(systemClock.date(m.timeZone), -1);
    const first = m.hireDate > '2026-01-01' ? m.hireDate : CalendarDate.parse('2026-01-01');
    if (first > yesterday) return;
    const window = { from: `${first}T00:00:00.000Z`, to: `${yesterday}T23:59:59.999Z` };
    const [had, requests] = await uow.run(tenantId, (tx) =>
      Promise.all([
        tx.attendance.punchesOf([m.personId], window as never),
        tx.requests.list({ personIds: [m.personId], statuses: ['approved', 'taken'] }),
      ]),
    );
    const off = new Set(holidaysAt.get(m.locationKey ?? '') ?? []);
    for (const r of requests) {
      for (let d = r.request.span.from; d <= r.request.span.to; d = addDays(d, 1)) off.add(d);
    }
    const kept = had.get(m.personId) ?? [];
    if (kept.length > 0) {
      // Clocked already: only the days since found to be off (a holiday, leave) are taken back.
      const wrong = kept.filter((p) => off.has(fixedClock(p.at).date(m.timeZone))).map((p) => p.id);
      for (let i = 0; i < wrong.length; i += 2000) {
        await withTenant(db, tenantId, (tx) =>
          tx.delete(punch).where(inArray(punch.id, wrong.slice(i, i + 2000))),
        );
      }
      written -= wrong.length;
      return;
    }
    const workDays = new Set(m.workPattern ?? [1, 2, 3, 4, 5]);
    const recent = addDays(yesterday, -20);
    // Somebody on leave stopped clocking a while ago.
    const last = m.status === 'on_leave' ? addDays(yesterday, -45) : yesterday;
    const rows: (typeof punch.$inferInsert)[] = [];
    for (let d = first; d <= last; d = addDays(d, 1)) {
      if (!workDays.has(weekday(d)) || off.has(d)) continue;
      for (const p of planDay(m.personId, d, d >= recent)) {
        const at = instantIn(d, p.minute, m.timeZone);
        rows.push({
          tenantId,
          id: uuidv7(),
          personId: m.personId,
          at,
          recordedAt: at,
          kind: p.kind,
          source: 'web',
          workModel: 'office',
        });
      }
    }
    for (let i = 0; i < rows.length; i += 2000) {
      await withTenant(db, tenantId, (tx) => tx.insert(punch).values(rows.slice(i, i + 2000)));
    }
    written += rows.length;
  });
  return written;
}

async function superAdministrators(members: readonly Member[]): Promise<void> {
  const emails = (process.env['SUPER_ADMIN_EMAILS'] ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== '');
  if (emails.length === 0) return;
  const fga = timeoffFgaFrom(process.env, () => systemClock.date('UTC'));
  if (fga === null)
    throw new Error('OPENFGA_URL is not set: nowhere to name a super administrator');
  for (const m of members) {
    if (m.accountId === null || !emails.includes((m.workEmail ?? '').toLowerCase())) continue;
    await fga.setSuperAdmin(tenantId, m.accountId, true);
    logger.info({ personId: m.personId }, 'super administrator named');
  }
}

async function main(): Promise<void> {
  const members = (await uow.run(tenantId, (tx) => tx.members.list())).filter(
    (m) => m.status !== 'left',
  );
  logger.info({ members: members.length }, 'seeding the year');
  await superAdministrators(members);
  await leaveTypesAndPolicies();
  const holidaysAt = await calendars(members);

  const byId = new Map(members.map((m) => [m.personId as string, m]));
  const started = members.filter((m) => m.hireDate <= systemClock.date(m.timeZone));
  let sent = 0;
  let refused = 0;
  let done = 0;
  await inPools(started, 6, async (m) => {
    const approver = m.managerPersonId === null ? null : (byId.get(m.managerPersonId) ?? null);
    const r = await leaveOf(m, holidaysAt.get(m.locationKey ?? '') ?? new Set(), approver);
    sent += r.sent;
    refused += r.refused;
    done += 1;
    if (done % 250 === 0) logger.info({ done, sent, refused }, 'time off so far');
  });
  logger.info({ sent, refused }, 'time off requested');

  const settled = await markTakenDue(depsAt(now))(tenantId);
  logger.info({ settled: settled.ok ? settled.value : settled.error.message }, 'taken settled');

  const punches = await punchesOf(started, holidaysAt);
  logger.info({ punches }, 'attendance written');
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, 'seeding the year failed');
    process.exitCode = 1;
  })
  .finally(() => client.end({ timeout: 5 }));
