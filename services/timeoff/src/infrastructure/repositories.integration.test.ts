import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readdir, readFile } from 'node:fs/promises';
import { fixedClock } from '@kithena/domain-kit';
import {
  DateSpan,
  DayAmount,
  LeaveApproved,
  LeaveChanged,
  LeaveCounterProposed,
  LeaveRequested,
  LeaveTypeKey,
  ParentalBirthRecorded,
  ParentalPlanSubmitted,
  PersonId,
  PolicyPublished,
  TenantId,
} from '@kithena/contracts';
import { startPostgres } from '@kithena/testing';

import { upsertMember } from '../application/member/sync.js';
import {
  answerParental,
  editParentalBlocks,
  parentalScreen,
  recordParentalBirth,
  sendParentalPlan,
} from '../application/parental/parental.js';
import { MemberFields, type Tx, type UnitOfWork } from '../application/ports.js';
import { sendRequest } from '../application/request/request.js';
import { sequentialIds } from '../application/testing/in-memory.js';
import {
  caller,
  MADRID,
  member,
  people,
  PLATFORM,
  sickType,
  TENANT,
  vacationPolicy,
  vacationType,
} from '../application/testing/world.js';
import { es } from '../country-packs/es.js';
import { week } from '../domain/attendance/t20.fixture.js';
import { decideAdjustment, proposeAdjustment } from '../domain/balance/adjustment.js';
import { entry } from '../domain/balance/ledger.js';
import type { EventContext } from '../domain/context.js';
import { LeaveType } from '../domain/policy/leave-type.js';
import { Policy, policyId } from '../domain/policy/policy.js';
import { LeaveRequest, leaveRequestId, type Span } from '../domain/request/leave-request.js';
import { knownTenants } from './drizzle-members.js';
import { drizzleUnitOfWork } from './unit-of-work.js';

/**
 * TOF-034: every store against the real migrations, as `svc_timeoff`. Each
 * aggregate goes in, comes back equal, and what it raised is in
 * `timeoff.outbox` from the same transaction.
 */

const OTHER = TenantId.parse('99999999-9999-7999-8999-999999999999');
const MARCO_ACCOUNT = '0000000a-0000-7000-8000-000000000001';
const MIGRATIONS_DIR = new URL('../../../../migrations/', import.meta.url);

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let asTimeoff: PostgresJsDatabase;
let uow: UnitOfWork;

const ids = sequentialIds();
const ctx: EventContext = {
  clock: fixedClock('2026-10-01T09:00:00.000Z'),
  newId: ids,
  actor: { kind: 'system', process: 'integration-test' },
  correlationId: '00000000-0000-4000-8000-0000000000c1',
  causationId: null,
  timeZone: 'Europe/Madrid',
};
const run = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => uow.run(TENANT, fn);
const must = <T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const outboxNames = async (aggregateId: string): Promise<string[]> => {
  const rows = await asTimeoffIn(TENANT, (tx) =>
    tx.execute(
      sql`SELECT event_name FROM timeoff.outbox WHERE aggregate_id = ${aggregateId} ORDER BY event_id`,
    ),
  );
  return [...rows].map((r) => String(r['event_name']));
};

function asTimeoffIn<T>(tenant: string, fn: (tx: PostgresJsDatabase) => Promise<T>): Promise<T> {
  return asTimeoff.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant}, true)`);
    return fn(tx);
  });
}

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  adminClient = postgres(pg.url, { max: 1, onnotice: () => {} });
  const admin = drizzle(adminClient);
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.includes('_timeoff_')).toSorted();
  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop -- in order, each builds on the last
    await admin.execute(sql.raw(await readFile(new URL(file, MIGRATIONS_DIR), 'utf8')));
  }
  await admin.execute(sql`ALTER ROLE svc_timeoff LOGIN PASSWORD 'svc_timeoff'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_timeoff';
  asService.password = 'svc_timeoff';
  serviceClient = postgres(asService.toString(), { max: 4 });
  asTimeoff = drizzle(serviceClient);
  uow = drizzleUnitOfWork(asTimeoff);

  // What every section stands on: the team and two leave types.
  await run(async (tx) => {
    for (const def of [vacationType(), sickType()]) {
      // oxlint-disable-next-line no-await-in-loop -- two rows
      await tx.leaveTypes.save(must(LeaveType.define(def)));
    }
    for (const [name, personId] of Object.entries(people)) {
      // oxlint-disable-next-line no-await-in-loop -- seven rows
      await tx.members.save(member(personId, name));
    }
  });
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

describe('members', () => {
  it('round-trips an imported member, nothing applied yet, as it went in', async () => {
    expect(await run((tx) => tx.members.get(people.adam))).toEqual(member(people.adam, 'adam'));
    expect(await run((tx) => tx.members.list({ teamKey: PLATFORM }))).toHaveLength(7);
  });

  it('moves forward with an event and refuses to be moved back by an older one', async () => {
    const adam = member(people.adam, 'Adam Novak');
    const newer = { ...adam, lastEventId: ids(), lastEffectiveFrom: adam.hireDate };
    await run((tx) => tx.members.save({ ...newer, displayName: 'Adam N.' }));
    await run((tx) =>
      tx.members.save({
        ...adam,
        displayName: 'stale',
        lastEventId: ids(),
        lastEffectiveFrom: '2021-01-01' as typeof adam.hireDate,
      }),
    );
    expect(await run((tx) => tx.members.get(people.adam))).toEqual({
      ...newer,
      displayName: 'Adam N.',
    });
  });

  it('keeps a leaver as left, and the zone', async () => {
    const hana = member(people.hana, 'hana', { status: 'left', timeZone: 'Atlantic/Canary' });
    await run((tx) => tx.members.save(hana));
    expect(await run((tx) => tx.members.get(people.hana))).toEqual(hana);
  });

  it('lists the tenant for background jobs once it has a member', async () => {
    expect(await knownTenants(asTimeoff)).toEqual([TENANT]);
  });

  it('round-trips a location', async () => {
    const madrid = {
      locationKey: MADRID,
      name: 'Madrid',
      country: 'ES',
      timeZone: 'Europe/Madrid',
    };
    await run((tx) => tx.locations.save(madrid as Parameters<Tx['locations']['save']>[0]));
    expect(await run((tx) => tx.locations.get(MADRID))).toEqual(madrid);
  });
});

describe('leave types', () => {
  it('comes back hidden, and deleted, as it was saved', async () => {
    const sick = must(LeaveType.define(sickType()));
    sick.hide();
    await run((tx) => tx.leaveTypes.save(sick));
    const back = await run((tx) => tx.leaveTypes.get(sick.id));
    expect(back?.definition).toEqual(sick.definition);
    expect([back?.hidden, back?.deleted]).toEqual([true, false]);

    sick.show();
    await run((tx) => tx.leaveTypes.save(sick));
    expect((await run((tx) => tx.leaveTypes.get(sick.id)))?.hidden).toBe(false);
  });
});

describe('policies', () => {
  it('round-trips draft, publish and the next draft, with policy.published in the outbox', async () => {
    const id = policyId(ids());
    const policy = Policy.draft({ id, tenantId: TENANT, definition: vacationPolicy() });
    await run((tx) => tx.policies.save(policy));

    must(policy.publish('2026-01-01' as never, ctx));
    await run(async (tx) => {
      await tx.policies.save(policy);
      await tx.outbox.publish(policy.drainEvents());
    });
    must(policy.revise(vacationPolicy({ allowance: [{ fromYears: 0, days: '26.000' }] })));
    // The published version is skipped, not rewritten: the table refuses that.
    await run((tx) => tx.policies.save(policy));

    const back = await run((tx) => tx.policies.get(id));
    expect(back?.versions).toEqual(policy.versions);
    expect(
      (await run((tx) => tx.policies.forLeaveType(vacationType().key))).map((p) => p.id),
    ).toEqual([id]);
    expect(await outboxNames(id)).toEqual([PolicyPublished.name]);
  });
});

describe('balance adjustments', () => {
  it('round-trips a pending one, its decision, and lists by status', async () => {
    const asked = {
      ...must(
        proposeAdjustment(
          {
            personId: people.adam,
            leaveTypeKey: vacationType().key,
            amount: '-1.500',
            effectiveOn: '2026-10-01' as never,
            reason: 'Half a day twice, not booked',
            proposedBy: MARCO_ACCOUNT,
            byHr: false,
          },
          ctx,
        ),
      ),
      entryId: null,
    };
    await run((tx) => tx.adjustments.save(asked));
    expect(await run((tx) => tx.adjustments.get(asked.adjustmentId))).toEqual(asked);
    expect(
      (await run((tx) => tx.adjustments.list({ status: 'pending' }))).map((a) => a.adjustmentId),
    ).toEqual([asked.adjustmentId]);

    const decided = {
      ...must(decideAdjustment(asked, { approve: true, by: 'acct-hr' }, ctx)),
      entryId: ids(),
    };
    await run((tx) => tx.adjustments.save(decided));
    expect(await run((tx) => tx.adjustments.get(asked.adjustmentId))).toEqual(decided);
    expect(await run((tx) => tx.adjustments.list({ status: 'pending' }))).toEqual([]);
    expect(
      await asTimeoffIn(OTHER, (tx) => tx.execute(sql`SELECT id FROM timeoff.balance_adjustment`)),
    ).toHaveLength(0);
  });
});

describe('the ledger', () => {
  it('appends and reads back as the contract has it', async () => {
    const grant = entry(
      {
        personId: people.omar,
        leaveTypeKey: vacationType().key,
        unit: 'day',
        kind: 'grant',
        amount: '25.000',
        effectiveOn: '2026-01-01' as never,
        policyVersion: 1,
      },
      ctx,
    );
    const correction = entry(
      {
        personId: people.omar,
        leaveTypeKey: vacationType().key,
        unit: 'day',
        kind: 'grant',
        amount: '24.500',
        effectiveOn: '2026-01-01' as never,
        policyVersion: 1,
        supersedes: grant.entryId,
      },
      ctx,
    );
    await run((tx) => tx.ledger.append([grant, correction]));
    const back = await run((tx) => tx.ledger.forMember(people.omar, vacationType().key));
    expect(back).toEqual([
      { ...grant, occurredAt: '2026-10-01T09:00:00.000Z' },
      { ...correction, occurredAt: '2026-10-01T09:00:00.000Z' },
    ]);
    expect(
      await run((tx) => tx.ledger.forMembers([people.omar, people.hana], vacationType().key)),
    ).toEqual(back);
    expect(await run((tx) => tx.ledger.forMembers([]))).toEqual([]);
  });
});

describe('requests', () => {
  const span = (from: string, to: string, workingDays: string): Span => ({
    from: from as never,
    to: to as never,
    startsHalfDay: false,
    endsHalfDay: false,
    workingDays: DayAmount.parse(workingDays),
  });

  it('round-trips a request, its routing and a swap with a gap, with every event in the outbox', async () => {
    const id = leaveRequestId(ids());
    const { request, entries } = must(
      LeaveRequest.request(
        {
          id,
          tenantId: TENANT,
          personId: people.adam,
          // What a request keeps of its type; the rest is the type's own row.
          leaveType: {
            key: vacationType().key,
            category: 'annual_leave',
            tracked: true,
            paid: 'paid',
            unit: 'day',
          },
          span: span('2026-10-19', '2026-10-23', '5.000'),
          verdict: { kind: 'fits' },
        },
        ctx,
      ),
    );
    const record = {
      request,
      routing: {
        chain: ['manager', 'hr'] as const,
        step: 0,
        since: '2026-10-01' as never,
        escalatedTo: null,
      },
      note: 'Family visit',
      requestedAt: '2026-10-01T09:00:00.000Z' as never,
      proposedBy: null,
      proposalMessage: null,
    };
    await run(async (tx) => {
      await tx.requests.save(record);
      await tx.ledger.append(entries);
      await tx.outbox.publish(request.drainEvents());
    });

    const back = await run((tx) => tx.requests.get(id));
    expect(back?.request.snapshot).toEqual(request.snapshot);
    expect(back?.routing).toEqual(record.routing);
    expect(back?.note).toBe('Family visit');

    // Who decided a step, as the Inbox reads it back.
    const decision = {
      id: ids(),
      requestId: id,
      outcome: 'declined' as const,
      role: 'manager' as const,
      decidedBy: MARCO_ACCOUNT,
      reason: 'Two people are already out that day.',
      decidedAt: '2026-10-02T09:00:00.000Z' as never,
    };
    await run((tx) => tx.requests.recordDecision(decision));
    expect(await run((tx) => tx.requests.decisions([id]))).toEqual([decision]);
    expect(await run((tx) => tx.requests.decisions([]))).toEqual([]);

    // Marco swaps the 21st out; Adam accepts.
    const loaded = back?.request as LeaveRequest;
    must(
      loaded.counterPropose(
        {
          by: MARCO_ACCOUNT,
          proposals: [
            {
              spans: [
                { from: '2026-10-19' as never, to: '2026-10-20' as never },
                { from: '2026-10-22' as never, to: '2026-10-23' as never },
              ],
              workingDays: DayAmount.parse('4.000'),
            },
          ],
        },
        ctx,
      ),
    );
    await run(async (tx) => {
      await tx.requests.save({ ...record, request: loaded, proposedBy: MARCO_ACCOUNT });
      await tx.outbox.publish(loaded.drainEvents());
    });
    const proposed = (await run((tx) => tx.requests.get(id)))?.request as LeaveRequest;
    expect(proposed.proposals).toEqual(loaded.proposals);
    must(proposed.acceptCounter({ index: 0, approvedBy: MARCO_ACCOUNT, jurisdiction: 'ES' }, ctx));
    await run(async (tx) => {
      await tx.requests.save({
        ...record,
        request: proposed,
        routing: { ...record.routing, step: 2 },
      });
      await tx.outbox.publish(proposed.drainEvents());
    });

    const accepted = await run((tx) => tx.requests.get(id));
    expect(accepted?.request.snapshot).toEqual(proposed.snapshot);
    expect(accepted?.request.spans).toHaveLength(2);
    // The gap day is inside the bounds, as the in-memory store answers.
    expect(
      await run((tx) =>
        tx.requests.list({
          from: '2026-10-21' as never,
          to: '2026-10-21' as never,
          statuses: ['approved'],
        }),
      ),
    ).toHaveLength(1);
    expect(await run((tx) => tx.requests.list({ personIds: [people.leo] }))).toEqual([]);
    expect(await outboxNames(id)).toEqual([
      LeaveRequested.name,
      LeaveCounterProposed.name,
      LeaveChanged.name,
      LeaveApproved.name,
    ]);
  });

  it('pages newest asked first and soonest first, each row once, from the last one’s place', async () => {
    const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
    const made: string[] = [];
    for (const [i, day] of days.entries()) {
      const id = leaveRequestId(ids());
      made.push(id);
      const { request } = must(
        LeaveRequest.request(
          {
            id,
            tenantId: TENANT,
            personId: people.omar,
            leaveType: {
              key: vacationType().key,
              category: 'annual_leave',
              tracked: true,
              paid: 'paid',
              unit: 'day',
            },
            span: span(day, day, '1.000'),
            verdict: { kind: 'fits' },
          },
          ctx,
        ),
      );
      request.drainEvents();
      // Asked in the reverse of their days, so the two orders differ.
      // oxlint-disable-next-line no-await-in-loop -- one row after another
      await run((tx) =>
        tx.requests.save({
          request,
          routing: { chain: ['manager'], step: 0, since: '2026-10-01' as never, escalatedTo: null },
          note: null,
          requestedAt: `2026-10-0${String(9 - i)}T09:00:00.000Z` as never,
          proposedBy: null,
          proposalMessage: null,
        }),
      );
    }
    const walk = async (order: 'newest' | 'soonest') => {
      const seen: string[] = [];
      let after: string | null = null;
      do {
        // oxlint-disable-next-line no-await-in-loop -- page after page
        const page = await run((tx) =>
          tx.requests.page({
            personIds: [people.omar],
            statuses: ['pending'],
            from: '2026-11-01' as never,
            order,
            after,
            limit: 2,
          }),
        );
        seen.push(...page.records.map((r) => r.request.id));
        after = page.next;
      } while (after !== null);
      return seen;
    };
    expect(await walk('soonest')).toEqual(made);
    expect(await walk('newest')).toEqual(made);
  });
});

describe('settings', () => {
  it('keeps approval rules, auto-approval, a delegation and a team minimum', async () => {
    const rules = [
      { subject: 'request', leaveTypes: null, when: 'always', approvers: ['manager'] },
      { subject: 'request', leaveTypes: null, when: 'below_zero', approvers: ['manager', 'hr'] },
    ] as const;
    const delegation = {
      approverId: people.marco,
      delegateId: people.omar,
      range: { from: '2026-12-21' as never, to: '2026-12-31' as never },
      automatic: true,
      salaryRelated: false,
    };
    await run(async (tx) => {
      await tx.approvals.setRules([...rules, rules[0]]);
      await tx.approvals.setRules(rules);
      await tx.approvals.setAutoApproval({
        shortenOrCancel: false,
        sickUnderDays: null,
        oneDayAboveMinimum: true,
      });
      await tx.approvals.saveDelegation(delegation);
      await tx.approvals.setTeamMinimum(PLATFORM, { atLeast: 5, unit: 'people' });
    });
    await run(async (tx) => {
      expect(await tx.approvals.rules()).toEqual(rules);
      expect(await tx.approvals.autoApproval()).toEqual({
        shortenOrCancel: false,
        sickUnderDays: null,
        oneDayAboveMinimum: true,
      });
      expect(await tx.approvals.delegation(people.marco)).toEqual(delegation);
      expect(await tx.approvals.teamMinimum(PLATFORM)).toEqual({ atLeast: 5, unit: 'people' });
    });
    await run(async (tx) => {
      await tx.approvals.removeDelegation(people.marco);
      await tx.approvals.setTeamMinimum(PLATFORM, null);
    });
    expect(await run((tx) => tx.approvals.delegation(people.marco))).toBeNull();
    expect(await run((tx) => tx.approvals.teamMinimum(PLATFORM))).toBeNull();
  });

  it('keeps holiday layers and the ones a location observes, in order', async () => {
    const layers = es.calendars.madrid;
    await run(async (tx) => {
      for (const layer of layers) {
        // oxlint-disable-next-line no-await-in-loop -- three layers
        await tx.holidays.saveLayer(layer);
      }
      await tx.holidays.assign(MADRID, layers.map((l) => l.key).toReversed());
      await tx.holidays.assign(
        MADRID,
        layers.map((l) => l.key),
      );
    });
    await run(async (tx) => {
      // As saved, and when: a layer read back carries the instant it was kept.
      expect((await tx.holidays.layers()).toSorted((a, b) => a.key.localeCompare(b.key))).toEqual(
        layers
          .toSorted((a, b) => a.key.localeCompare(b.key))
          .map((l) => ({ ...l, savedAt: expect.any(String) as unknown })),
      );
      expect(await tx.holidays.assigned(MADRID)).toEqual(layers.map((l) => l.key));
    });
    await run((tx) => tx.holidays.removeLayer('madrid'));
    expect(await run((tx) => tx.holidays.assigned(MADRID))).toEqual(['es', 'es_md']);
  });

  it('bumps a feed version from nothing', async () => {
    expect(await run((tx) => tx.feeds.version(people.adam))).toBe(0);
    expect(await run((tx) => tx.feeds.bump(people.adam))).toBe(1);
    expect(await run((tx) => tx.feeds.bump(people.adam))).toBe(2);
    expect(await run((tx) => tx.feeds.version(people.adam))).toBe(2);
  });
});

describe('attendance', () => {
  it('keeps punches, a schedule, the rules, periods, lines and overtime decisions', async () => {
    const schedule = {
      kind: 'fixed' as const,
      name: 'Office hours',
      week: { 1: { start: 540, end: 1050, breakMinutes: 30 } },
    };
    const rules = {
      breakAfterMinutes: 360,
      breakMinutes: 30,
      restMinutes: 720,
      weeklyMaxMinutes: 2520,
      overtime: { becomes: 'comp' as const, multiplier: '1.50' },
    };
    const period = {
      id: ids(),
      from: '2026-09-01' as never,
      to: '2026-09-30' as never,
      closedAt: null,
    };
    const line = {
      id: ids(),
      personId: people.adam,
      team: PLATFORM,
      date: '2026-09-29' as never,
      periodId: period.id,
      workedMinutes: 525,
      compMinutes: 45,
      paidMinutes: 0,
      supersedes: null,
    };
    await run(async (tx) => {
      for (const p of week) {
        // oxlint-disable-next-line no-await-in-loop -- in order, as punched
        await tx.attendance.appendPunch(people.adam, p);
      }
      await tx.attendance.setSchedule(people.adam, schedule);
      await tx.attendance.setRules(rules);
      await tx.attendance.savePeriod(period);
      await tx.attendance.appendLine(line);
      await tx.attendance.decideOvertime({
        personId: people.adam,
        date: line.date,
        minutes: 45,
        outcome: 'comp',
        decidedBy: MARCO_ACCOUNT,
      });
      await tx.attendance.savePeriod({ ...period, closedAt: '2026-10-01T09:00:00.000Z' as never });
      // Closed: a later save changes nothing rather than failing on the lock.
      await tx.attendance.savePeriod({ ...period, closedAt: null });
    });
    await run(async (tx) => {
      const punches = await tx.attendance.punches(people.adam);
      expect(punches.map((p) => [p.id, Date.parse(p.at), p.kind])).toEqual(
        week.map((p) => [p.id, Date.parse(p.at), p.kind]),
      );
      expect(await tx.attendance.schedule(people.adam)).toEqual(schedule);
      expect(await tx.attendance.schedule(people.omar)).toBeNull();
      // Many at once, as Insights reads them: Omar has neither.
      const many = await tx.attendance.punchesOf([people.adam, people.omar]);
      expect(many.get(people.adam)?.map((p) => p.id)).toEqual(punches.map((p) => p.id));
      expect(many.get(people.omar)).toEqual([]);
      expect([...(await tx.attendance.schedulesOf([people.adam, people.omar]))]).toEqual([
        [people.adam, schedule],
      ]);
      expect(await tx.attendance.rules()).toEqual(rules);
      expect(await tx.attendance.periods()).toEqual([
        { ...period, closedAt: '2026-10-01T09:00:00.000Z' },
      ]);
      expect(await tx.attendance.lines()).toEqual([line]);
      expect(await tx.attendance.overtime(people.adam)).toEqual([
        {
          personId: people.adam,
          date: line.date,
          minutes: 45,
          outcome: 'comp',
          decidedBy: MARCO_ACCOUNT,
        },
      ]);
    });
  });
});

describe('kiosks (TOF-107)', () => {
  it('keeps a device, its sequence and revocation, a skewed punch and credentials by hash', async () => {
    const deviceId = ids();
    const device = {
      id: deviceId,
      name: 'Main entrance',
      locationKey: MADRID,
      tokenHash: 'ab'.repeat(32),
      lastSeenAt: null,
      revokedAt: null,
      lastSequence: 0,
    };
    const pin = 'cd'.repeat(32);
    const [first] = week;
    if (first === undefined) throw new Error('the week has punches');
    const skewed = {
      ...first,
      id: ids(),
      source: 'kiosk' as const,
      deviceId,
      clockSkewSeconds: 300,
    };
    await run(async (tx) => {
      await tx.kiosks.saveDevice(device);
      await tx.kiosks.saveDevice({
        ...device,
        lastSequence: 7,
        lastSeenAt: '2026-10-01T09:00:00.000Z' as never,
      });
      await tx.kiosks.setCredential(people.adam, 'pin', pin);
      await tx.attendance.appendPunch(people.omar, skewed);
    });
    await run(async (tx) => {
      expect(await tx.kiosks.device(deviceId)).toMatchObject({ lastSequence: 7, revokedAt: null });
      expect(await tx.kiosks.holder('pin', pin)).toBe(people.adam);
      expect(await tx.kiosks.holder('badge', pin)).toBeNull();
      expect((await tx.attendance.punches(people.omar)).at(-1)?.clockSkewSeconds).toBe(300);
      await tx.kiosks.setCredential(people.adam, 'pin', null);
      expect(await tx.kiosks.holder('pin', pin)).toBeNull();
    });
    // No two members hold one PIN, whatever the application forgot to check.
    await run((tx) => tx.kiosks.setCredential(people.adam, 'pin', pin));
    await expect(run((tx) => tx.kiosks.setCredential(people.omar, 'pin', pin))).rejects.toThrow();
  });
});

describe('integrations (TOF-109)', () => {
  it('keeps a connection and a member’s grant, and forgets both on disconnecting', async () => {
    const slack = {
      provider: 'slack' as const,
      config: { name: 'Acme' },
      secret: 'sealed-bot-token',
      connectedAt: '2026-10-01T09:00:00.000Z' as never,
      connectedBy: MARCO_ACCOUNT,
    };
    await run(async (tx) => {
      await tx.integrations.save(slack);
      await tx.integrations.save({ ...slack, config: { name: 'Acme Inc' } });
      await tx.integrations.setMemberSecret('slack', people.adam, 'sealed-user-token');
    });
    await run(async (tx) => {
      expect(await tx.integrations.get('slack')).toEqual({
        ...slack,
        config: { name: 'Acme Inc' },
      });
      expect(await tx.integrations.memberSecret('slack', people.adam)).toBe('sealed-user-token');
      await tx.integrations.remove('slack');
      expect(await tx.integrations.list()).toEqual([]);
      expect(await tx.integrations.memberSecret('slack', people.adam)).toBeNull();
    });
  });
});

describe('SCIM (TOF-114)', () => {
  it('keeps a connection and its revocation, and finds a user by userName whatever its case', async () => {
    const id = ids();
    await run(async (tx) => {
      await tx.scim.saveConnection({
        id,
        tokenHash: 'ef'.repeat(32),
        createdBy: MARCO_ACCOUNT,
        revokedAt: null,
      });
      await tx.scim.saveUser({
        personId: people.adam,
        userName: 'Adam.Novak@acme.example',
        externalId: 'entra-adam',
        createdAt: '2026-10-01T09:00:00.000Z' as never,
        updatedAt: '2026-10-01T09:00:00.000Z' as never,
      });
      await tx.scim.saveConnection({
        id,
        tokenHash: 'ef'.repeat(32),
        createdBy: MARCO_ACCOUNT,
        revokedAt: '2026-10-02T09:00:00.000Z' as never,
      });
    });
    await run(async (tx) => {
      expect((await tx.scim.connection(id))?.revokedAt).not.toBeNull();
      expect((await tx.scim.byUserName('adam.novak@ACME.example'))?.personId).toBe(people.adam);
      expect((await tx.scim.users()).map((u) => u.externalId)).toEqual(['entra-adam']);
    });
    // One userName per company, whatever its case.
    await expect(
      run((tx) =>
        tx.scim.saveUser({
          personId: people.omar,
          userName: 'ADAM.NOVAK@acme.example',
          externalId: null,
          createdAt: '2026-10-01T09:00:00.000Z' as never,
          updatedAt: '2026-10-01T09:00:00.000Z' as never,
        }),
      ),
    ).rejects.toThrow();
  });
});

/** On what the sections above stored: the published vacation policy and Madrid's layers. */
describe('the use cases, over Drizzle', () => {
  it('hires a member with their grant, and sends a request whose rows name it', async () => {
    const nora = PersonId.parse('00000000-0000-7000-8000-000000000008');
    const deps = {
      uow,
      clock: fixedClock('2026-10-01T07:00:00.000Z'),
      newId: ids,
      timers: { started: async () => {}, closed: async () => {} },
    };
    const hired = must(
      await upsertMember(deps)(TENANT, MemberFields.parse({ ...member(nora, 'Nora Field') }), {
        eventId: ids(),
        effectiveFrom: '2026-10-01' as never,
        correlationId: ctx.correlationId,
      }),
    );
    expect(hired.posted.map((e) => [e.kind, e.amount])).toEqual([['grant', '25.000']]);

    const sent = must(
      await sendRequest(deps)(caller(nora), {
        leaveTypeKey: vacationType().key,
        span: DateSpan.parse({ from: '2026-11-02', to: '2026-11-06' }),
      }),
    );
    expect(sent.status).toBe('pending');
    const rows = await run((tx) => tx.ledger.forMember(nora, vacationType().key));
    expect(rows.map((e) => [e.kind, e.amount, e.requestId])).toEqual([
      ['grant', '25.000', null],
      // Monday 2 November is the Madrid region's moved Todos los Santos, read from the stored layers.
      ['booking', '-4.000', sent.requestId],
    ]);
    expect(await outboxNames(sent.requestId)).toEqual([LeaveRequested.name]);
  });
});

describe('parental plans', () => {
  it('keeps a plan and its blocks through answers, edits, sending and a birth', async () => {
    const deps = {
      uow,
      clock: fixedClock('2026-10-01T07:00:00.000Z'),
      newId: ids,
      authz: { check: () => Promise.resolve(false), members: () => Promise.resolve([]) },
      notifier: { notify: () => Promise.resolve() },
    };
    await run((tx) =>
      tx.parental.setCompany({
        extraWeeks: 2,
        afterServiceYears: 1,
        leaveTypeKey: LeaveTypeKey.parse('company_parental'),
      }),
    );
    const adam = caller(people.adam);
    const { planId } = must(
      await answerParental(deps)(adam, {
        role: 'other_parent',
        childDate: '2027-01-14' as never,
        singleParent: false,
        children: 1,
        teamSees: 'away',
      }),
    );
    must(
      await editParentalBlocks(deps)(adam, {
        planId,
        blocks: [
          { kind: 'mandatory', from: '2027-01-14' as never, to: '2027-02-24' as never },
          { kind: 'flexible', from: '2027-08-02' as never, to: '2027-08-22' as never },
        ],
      }),
    );
    must(await sendParentalPlan(deps)(adam, planId));
    must(await recordParentalBirth(deps)(adam, { planId, birth: '2027-01-12' as never }));

    const stored = await run((tx) => tx.parental.get(planId));
    expect(stored).toMatchObject({
      status: 'submitted',
      country: 'ES',
      dueDate: '2027-01-14',
      birth: '2027-01-12',
      childDate: '2027-01-12',
      teamSees: 'away',
      version: 2,
      company: { extraWeeks: 2, afterServiceYears: 1, leaveTypeKey: 'company_parental' },
    });
    expect(stored?.blocks.map((b) => [b.kind, b.leaveTypeKey, b.from, b.to])).toEqual([
      ['mandatory', 'parental', '2027-01-12', '2027-02-22'],
      ['flexible', 'parental', '2027-08-02', '2027-08-22'],
    ]);
    expect(await outboxNames(planId)).toEqual([
      ParentalPlanSubmitted.name,
      ParentalBirthRecorded.name,
    ]);
    const screen = must(await parentalScreen(deps)(adam, {}));
    expect(screen.plan?.planId).toBe(planId);
  });

  it('holds one open plan per member', async () => {
    const [open] = await run((tx) => tx.parental.list({ personId: people.adam }));
    if (open === undefined) throw new Error('no plan');
    await expect(run((tx) => tx.parental.save({ ...open, id: ids() as never }))).rejects.toThrow();
  });
});

describe('the unit of work', () => {
  it('rolls back the write and its events together when it throws', async () => {
    const id = policyId(ids());
    const policy = Policy.draft({ id, tenantId: TENANT, definition: vacationPolicy() });
    must(policy.publish('2026-01-01' as never, ctx));
    await expect(
      run(async (tx) => {
        await tx.policies.save(policy);
        await tx.outbox.publish(policy.drainEvents());
        throw new Error('refused after writing');
      }),
    ).rejects.toThrow('refused after writing');
    expect(await run((tx) => tx.policies.get(id))).toBeNull();
    expect(await outboxNames(id)).toEqual([]);
  });

  it('shows another tenant none of it', async () => {
    await uow.run(OTHER, async (tx) => {
      expect(await tx.members.list()).toEqual([]);
      expect(await tx.policies.list()).toEqual([]);
      expect(await tx.requests.list({})).toEqual([]);
      expect(await tx.holidays.layers()).toEqual([]);
      expect(await tx.attendance.punches(people.adam)).toEqual([]);
      expect(await tx.parental.list({})).toEqual([]);
      expect(await tx.parental.company()).toBeNull();
    });
  });
});
