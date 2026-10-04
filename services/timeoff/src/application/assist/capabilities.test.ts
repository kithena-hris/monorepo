import { describe, expect, it } from 'vitest';
import {
  DateSpan,
  LedgerEntry,
  LeaveTypeDefinition,
  LeaveTypeKey,
  PersonId,
  RuntimeCatalogue,
  TeamKey,
  TimeOffAway,
  TimeOffBalances,
  TimeOffManagers,
} from '@kithena/contracts';

import { LeaveType } from '../../domain/policy/leave-type.js';
import { decideRequest } from '../approval/decide.js';
import type { Caller } from '../ports.js';
import { sendRequest } from '../request/request.js';
import { setChatAnswers } from '../settings/chat.js';
import {
  caller,
  hr,
  MADRID,
  member,
  people,
  PLATFORM,
  sickType,
  TENANT,
  vacationType,
  world,
} from '../testing/world.js';
import { away, balances, capabilityCatalogue, managers } from './capabilities.js';

/** Assistant PRD §8.5: what Time Off offers the assistant, as the asker. */

describe('Time Off’s capability catalogue (AST-022)', () => {
  it('serves away and managers, leave types with private ones marked, teams and the denied words', async () => {
    const app = world();
    const answer = await capabilityCatalogue(app.deps)(caller(people.adam));
    if (!answer.ok) throw new Error(answer.error.message);
    const catalogue = RuntimeCatalogue.parse(answer.value);
    expect(catalogue.module).toBe('timeoff');
    expect(catalogue.serves).toEqual([
      { name: 'timeoff.away', version: 1 },
      { name: 'timeoff.managers', version: 1 },
      { name: 'timeoff.balances', version: 1 },
    ]);
    expect(catalogue.leaveTypes).toEqual([
      { key: 'sick', name: 'Sick', private: true, category: 'sick_leave' },
      { key: 'vacation', name: 'Vacation', private: false, category: 'annual_leave' },
    ]);
    const fields = catalogue.fields['timeoff.away'] ?? [];
    expect(fields.map((f) => f.key)).toEqual(['leave_type', 'team']);
    // A private type is never an option by name: the assistant offers it only masked (§12.2).
    expect(fields[0]?.options).toEqual([{ value: 'vacation', label: 'Vacation' }]);
    expect(fields[1]?.options).toEqual([{ value: 'platform', label: 'Platform' }]);
    expect(catalogue.denied.find((d) => d.key === 'sick_note')?.labels).toContain('sick leave');
    // Nobody chose to name private leave in chat, so the assistant does not (AST-029a).
    expect(catalogue.chatNamesPrivateLeave).toBe(false);
  });

  it('is configuration only, so HR and an employee are offered the same', async () => {
    const app = world();
    const adam = await capabilityCatalogue(app.deps)(caller(people.adam));
    const ada = await capabilityCatalogue(app.deps)(hr);
    expect(ada).toEqual(adam);
  });

  it('marks a type private by its visibility as well as its category', async () => {
    const app = world();
    const comp = LeaveType.define(
      LeaveTypeDefinition.parse({
        ...vacationType(),
        key: 'comp',
        name: { default: 'Comp' },
        visibility: 'off_only',
      }),
    );
    if (!comp.ok) throw new Error(comp.error.message);
    app.state(TENANT).leaveTypes.set('comp', comp.value);
    const answer = await capabilityCatalogue(app.deps)(hr);
    expect(answer.ok && answer.value.leaveTypes.find((t) => t.key === 'comp')).toEqual({
      key: 'comp',
      name: 'Comp',
      private: true,
      category: 'annual_leave',
    });
  });

  it('says each type’s category, so the assistant masks "off sick" as well as the type’s name', async () => {
    const app = world();
    const answer = await capabilityCatalogue(app.deps)(hr);
    if (!answer.ok) throw new Error(answer.error.message);
    // A company that calls sick leave "Baja médica" is still asked about people "off sick".
    expect(RuntimeCatalogue.parse(answer.value).leaveTypes.find((t) => t.private)?.category).toBe(
      'sick_leave',
    );
  });
});

/* ------------------------------------------------------------ timeoff.away -- */

const ZOE = PersonId.parse('00000000-0000-7000-8000-000000000099');
const OMAR_DIAZ = PersonId.parse('00000000-0000-7000-8000-000000000098');
const TUESDAY = { from: '2026-10-06', to: '2026-10-06' };

/**
 * Tuesday 6 October: Adam and Yuki off sick, Omar and Leo (half a day) on
 * vacation, Hana's vacation still waiting, and Zoe, in Sales and approved by
 * Ravi, on vacation. `sick: false` is the same week with nobody off sick.
 */
async function october(options: { sick?: boolean } = {}) {
  const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
  const s = app.state(TENANT);
  s.minimums.delete(PLATFORM);
  s.locations.set(MADRID, {
    locationKey: MADRID,
    name: 'Madrid',
    country: 'ES',
    timeZone: 'Europe/Madrid',
  });
  s.members.set(
    ZOE,
    member(ZOE, 'Zoe Lane', {
      teamKey: TeamKey.parse('sales'),
      teamName: 'Sales',
      managerPersonId: people.ravi,
    }),
  );
  const send = async (who: PersonId, key: string, span: Record<string, unknown>) => {
    const sent = await sendRequest(app.deps)(caller(who), {
      leaveTypeKey: LeaveTypeKey.parse(key),
      span: DateSpan.parse(span),
    });
    if (!sent.ok) throw new Error(sent.error.message);
    return sent.value.requestId;
  };
  const approve = async (by: PersonId | Caller, requestId: string) => {
    const done = await decideRequest(app.deps)(typeof by === 'string' ? caller(by) : by, {
      requestId: requestId as never,
      decision: 'approve',
    });
    if (!done.ok) throw new Error(done.error.message);
  };
  if (options.sick !== false) {
    await send(people.adam, 'sick', TUESDAY);
    await send(people.yuki, 'sick', { from: '2026-10-06', to: '2026-10-07' });
  }
  await approve(
    people.marco,
    await send(people.omar, 'vacation', { from: '2026-10-05', to: '2026-10-07' }),
  );
  await send(people.hana, 'vacation', TUESDAY);
  await approve(
    people.marco,
    await send(people.leo, 'vacation', { ...TUESDAY, endsHalfDay: true }),
  );
  // Zoe has no allowance yet, so borrowing a day goes on to HR.
  const zoes = await send(ZOE, 'vacation', TUESDAY);
  await approve(people.ravi, zoes);
  await approve(hr, zoes);
  return app;
}

type App = Awaited<ReturnType<typeof october>>;

async function ask(app: App, who: Caller, input: Record<string, unknown> = {}) {
  const answer = await away(app.deps)(
    who,
    TimeOffAway.schemas.input.parse({ on: TUESDAY, limit: 25, ...input }),
  );
  if (!answer.ok) throw new Error(answer.error.message);
  return TimeOffAway.schemas.output.parse(answer.value);
}

const lines = (result: Awaited<ReturnType<typeof ask>>) =>
  result.kind === 'people' ? result.rows.map((r) => [r.name, r.detail]) : result.kind;
const sick = { filters: [{ key: 'leave_type', op: 'in', values: ['sick'] }] };
const team = (values: string[]) => ({ filters: [{ key: 'team', op: 'in', values }] });

describe('timeoff.away (AST-023)', () => {
  it('shows HR everyone away, a private type only as Away, and no request still waiting', async () => {
    const app = await october();
    const result = await ask(app, hr);
    expect(lines(result)).toEqual([
      ['Adam Novak', 'Tue 6 · Away'],
      ['Leo Martin', 'Tue 6, half day · Vacation'],
      ['Omar Haddad', 'Mon 5 to Wed 7 · Vacation'],
      ['Yuki Tanaka', 'Tue 6 to Wed 7 · Away'],
      ['Zoe Lane', 'Tue 6 · Vacation'],
    ]);
    expect(result).toMatchObject({
      kind: 'people',
      total: 5,
      scope: 'everyone',
      described: 'away on Tuesday 6 October',
      notes: [],
    });
    expect(result.kind === 'people' && result.rows[0]?.groups).toEqual({
      team: 'Platform',
      location: 'Madrid',
    });
  });

  it('shows a teammate the team as the calendar does, and nobody else', async () => {
    const app = await october();
    const result = await ask(app, caller(people.omar));
    expect(lines(result)).toEqual([
      ['Adam Novak', 'Tue 6 · Away'],
      ['Leo Martin', 'Tue 6, half day · Vacation'],
      ['Omar Haddad', 'Mon 5 to Wed 7 · Vacation'],
      ['Yuki Tanaka', 'Tue 6 to Wed 7 · Away'],
    ]);
    expect(result).toMatchObject({ total: 4, scope: 'visible' });
  });

  it('matches a leave type only where the asker may see the type', async () => {
    const app = await october();
    for (const who of [hr, caller(people.marco)]) {
      // oxlint-disable-next-line no-await-in-loop -- two askers
      const result = await ask(app, who, sick);
      expect(lines(result)).toEqual([
        ['Adam Novak', 'Tue 6 · Away'],
        ['Yuki Tanaka', 'Tue 6 to Wed 7 · Away'],
      ]);
      expect(result).toMatchObject({ described: 'away on Sick on Tuesday 6 October' });
    }
    expect(await ask(app, caller(people.omar), sick)).toMatchObject({ rows: [], total: 0 });

    const vacation = await ask(app, caller(people.omar), {
      filters: [{ key: 'leave_type', op: 'in', values: ['Vacation'] }],
    });
    expect(lines(vacation)).toEqual([
      ['Leo Martin', 'Tue 6, half day · Vacation'],
      ['Omar Haddad', 'Mon 5 to Wed 7 · Vacation'],
    ]);
    const notVacation = { filters: [{ key: 'leave_type', op: 'not_in', values: ['vacation'] }] };
    expect(await ask(app, caller(people.omar), notVacation)).toMatchObject({ total: 0 });
    expect(await ask(app, hr, notVacation)).toMatchObject({ total: 2 });
  });

  it('names a private type where the company chose to and the asker sees it, and nowhere else (AST-029a)', async () => {
    const app = await october();
    expect(await setChatAnswers(app.deps)(hr, { namesPrivateLeave: true })).toMatchObject({
      ok: true,
    });
    for (const who of [hr, caller(people.marco)]) {
      // oxlint-disable-next-line no-await-in-loop -- two askers who see the type
      expect(lines(await ask(app, who, sick))).toEqual([
        ['Adam Novak', 'Tue 6 · Sick'],
        ['Yuki Tanaka', 'Tue 6 to Wed 7 · Sick'],
      ]);
    }
    // A teammate sees the day, never the type: the switch does not widen sight.
    expect(lines(await ask(app, caller(people.omar)))).toEqual([
      ['Adam Novak', 'Tue 6 · Away'],
      ['Leo Martin', 'Tue 6, half day · Vacation'],
      ['Omar Haddad', 'Mon 5 to Wed 7 · Vacation'],
      ['Yuki Tanaka', 'Tue 6 to Wed 7 · Away'],
    ]);
    expect(await ask(app, caller(people.omar), sick)).toMatchObject({ rows: [], total: 0 });
    const catalogue = await capabilityCatalogue(app.deps)(caller(people.omar));
    expect(catalogue.ok && catalogue.value.chatNamesPrivateLeave).toBe(true);
  });

  it('answers a teammate byte for byte the same whether two teammates are off sick or none are', async () => {
    const withSick = await ask(await october(), caller(people.omar), { ...sick, ids: true });
    const without = await ask(await october({ sick: false }), caller(people.omar), {
      ...sick,
      ids: true,
    });
    expect(JSON.stringify(withSick)).toBe(JSON.stringify(without));
    expect(withSick).toMatchObject({ rows: [], ids: [], total: 0 });
  });

  it('narrows to a team, to an earlier step’s people, and never widens', async () => {
    const app = await october();
    expect(await ask(app, hr, team(['platform']))).toMatchObject({
      total: 4,
      described: 'away in Platform on Tuesday 6 October',
    });
    expect(lines(await ask(app, hr, team(['sales'])))).toEqual([['Zoe Lane', 'Tue 6 · Vacation']]);
    // Zoe is not Omar's to see, so naming her id changes nothing.
    expect(lines(await ask(app, caller(people.omar), { personIds: [ZOE, people.adam] }))).toEqual([
      ['Adam Novak', 'Tue 6 · Away'],
    ]);
  });

  it('finds a name as the asker may, or says it is ambiguous or not found', async () => {
    const app = await october();
    app.state(TENANT).members.set(OMAR_DIAZ, member(OMAR_DIAZ, 'Omar Díaz'));
    expect(await ask(app, caller(people.adam), { name: 'zoe' })).toEqual({
      kind: 'not_found',
      name: 'zoe',
    });
    expect(await ask(app, caller(people.adam), { name: 'omar' })).toMatchObject({
      kind: 'ambiguous',
      candidates: [
        { personId: OMAR_DIAZ, name: 'Omar Díaz' },
        { personId: people.omar, name: 'Omar Haddad' },
      ],
    });
    expect(lines(await ask(app, caller(people.adam), { name: 'omar haddad' }))).toEqual([
      ['Omar Haddad', 'Mon 5 to Wed 7 · Vacation'],
    ]);
    expect(lines(await ask(app, caller(people.adam), { name: 'omar diaz' }))).toEqual([]);
    expect(lines(await ask(app, caller(people.omar), { name: '@me' }))).toEqual([
      ['Omar Haddad', 'Mon 5 to Wed 7 · Vacation'],
    ]);
    expect(await ask(app, hr, { name: '@me' })).toEqual({ kind: 'not_found', self: true });
  });

  it('counts without listing, gives every id when asked, and notes the holidays', async () => {
    const app = await october();
    const counted = await ask(app, hr, { limit: 0, ids: true });
    expect(counted).toMatchObject({ rows: [], total: 5 });
    expect(counted.kind === 'people' && counted.ids?.length).toBe(5);

    const week = await ask(app, caller(people.adam), {
      on: { from: '2026-10-12', to: '2026-10-18' },
    });
    expect(week).toMatchObject({
      total: 0,
      described: 'away from Monday 12 to Sunday 18 October',
      notes: ['Monday 12 October is a public holiday in Madrid.'],
    });
  });
});

/* -------------------------------------------------------- timeoff.managers -- */

async function managersOf(app: App, who: Caller, personIds: PersonId[], limit = 25) {
  const answer = await managers(app.deps)(
    who,
    TimeOffManagers.schemas.input.parse({ personIds, limit, ids: true }),
  );
  if (!answer.ok) throw new Error(answer.error.message);
  return TimeOffManagers.schemas.output.parse(answer.value);
}

describe('timeoff.managers (AST-024)', () => {
  const NIA = PersonId.parse('00000000-0000-7000-8000-000000000097');

  /** Zoe, in Sales, reports to Ravi; Nia, on Platform, reports to Zoe. */
  function org() {
    const app = world();
    const s = app.state(TENANT);
    s.members.set(
      ZOE,
      member(ZOE, 'Zoe Lane', {
        teamKey: TeamKey.parse('sales'),
        teamName: 'Sales',
        managerPersonId: people.ravi,
      }),
    );
    s.members.set(NIA, member(NIA, 'Nia Okafor', { managerPersonId: ZOE }));
    return app;
  }

  it('lists a manager once, however many of their people were found, and with no count', async () => {
    const result = await managersOf(org(), caller(people.marco), [people.adam, people.omar]);
    expect(result).toEqual({
      kind: 'people',
      rows: [
        {
          personId: people.marco,
          name: 'Marco Ruiz',
          groups: { team: 'Platform', location: 'madrid' },
          // Marco is asking: the answer says "(you)".
          self: true,
        },
      ],
      ids: [people.marco],
      total: 1,
      scope: 'visible',
      described: 'managers of people',
      notes: [],
    });
  });

  it('leaves out a person the asker may not see, and a manager they may not see', async () => {
    const app = org();
    // Omar does not see Zoe, so her manager is nobody's business of his.
    expect(await managersOf(app, caller(people.omar), [ZOE])).toMatchObject({ rows: [], total: 0 });
    // He sees Nia, a teammate, but not Zoe, her manager.
    expect(await managersOf(app, caller(people.omar), [NIA, people.adam])).toMatchObject({
      ids: [people.marco],
      total: 1,
    });
    const everyone = await managersOf(app, hr, [NIA, ZOE, people.adam]);
    expect(everyone).toMatchObject({ total: 3, scope: 'everyone' });
    // HR is none of them, so nobody is marked as the asker.
    expect(everyone.kind === 'people' && everyone.rows.some((r) => r.self)).toBe(false);
    expect(everyone.kind === 'people' && everyone.rows.map((r) => r.name)).toEqual([
      'Marco Ruiz',
      'Ravi Patel',
      'Zoe Lane',
    ]);
  });

  it('has nobody for somebody with no manager, and lists only up to the limit', async () => {
    const app = org();
    expect(await managersOf(app, hr, [people.marco])).toMatchObject({ rows: [], total: 0 });
    expect(await managersOf(app, hr, [NIA, ZOE, people.adam], 0)).toMatchObject({
      rows: [],
      total: 3,
    });
  });
});

/* -------------------------------------------------------- timeoff.balances -- */

describe('timeoff.balances (AST-030)', () => {
  /**
   * Everyone on Platform has the year's 25 days of vacation; Omar has asked
   * for two of them and Leo for half of one. Zoe, in Sales and approved by
   * Ravi, has no grant at all. Sick leave is tracked here, with Adam's 3 days.
   */
  async function balancesWorld() {
    const app = world('2026-10-01T07:00:00.000Z', { withGrant: true });
    const s = app.state(TENANT);
    s.minimums.delete(PLATFORM);
    s.members.set(
      ZOE,
      member(ZOE, 'Zoe Lane', {
        teamKey: TeamKey.parse('sales'),
        teamName: 'Sales',
        managerPersonId: people.ravi,
      }),
    );
    const sick = LeaveType.define(LeaveTypeDefinition.parse({ ...sickType(), tracked: true }));
    if (!sick.ok) throw new Error(sick.error.message);
    s.leaveTypes.set('sick', sick.value);
    s.ledger.push(
      LedgerEntry.parse({
        entryId: '0189eeee-0000-7000-8000-000000000001',
        personId: people.adam,
        leaveTypeKey: 'sick',
        kind: 'grant',
        amount: '3.000',
        unit: 'day',
        effectiveOn: '2026-01-01',
        occurredAt: '2025-12-01T00:00:00.000Z',
        policyVersion: null,
        supersedes: null,
        requestId: null,
        reason: null,
      }),
    );
    for (const [who, span] of [
      [people.omar, { from: '2026-10-06', to: '2026-10-07' }],
      [people.leo, { from: '2026-10-06', to: '2026-10-06', endsHalfDay: true }],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- two requests, in order
      const sent = await sendRequest(app.deps)(caller(who), {
        leaveTypeKey: LeaveTypeKey.parse('vacation'),
        span: DateSpan.parse(span),
      });
      if (!sent.ok) throw new Error(sent.error.message);
    }
    return app;
  }

  async function left(app: App, who: Caller, input: Record<string, unknown> = {}) {
    const answer = await balances(app.deps)(
      who,
      TimeOffBalances.schemas.input.parse({ limit: 25, ...input }),
    );
    if (!answer.ok) throw new Error(answer.error.message);
    return TimeOffBalances.schemas.output.parse(answer.value);
  }
  const of = (result: Awaited<ReturnType<typeof left>>) =>
    result.kind === 'people' ? result.rows.map((r) => [r.name, r.detail]) : result.kind;
  const more = (n: string) => ({ filters: [{ key: 'days_left', op: 'after', values: [n] }] });

  it('shows HR everyone’s vacation, from the ledger, as decimal text', async () => {
    const result = await left(await balancesWorld(), hr);
    expect(of(result)).toEqual([
      ['Adam Novak', '25 days left'],
      ['Hana Kim', '25 days left'],
      ['Leo Martin', '24.5 days left'],
      ['Marco Ruiz', '25 days left'],
      ['Omar Haddad', '23 days left'],
      ['Ravi Patel', '25 days left'],
      ['Yuki Tanaka', '25 days left'],
      ['Zoe Lane', '0 days left'],
    ]);
    expect(result).toMatchObject({
      total: 8,
      scope: 'everyone',
      described: 'with a Vacation balance',
    });
    expect(result.kind === 'people' && result.rows[0]?.groups).toEqual({
      team: 'Platform',
      location: 'madrid',
    });
  });

  it('shows an approver their own and the people they approve, and an employee only their own', async () => {
    const app = await balancesWorld();
    const marco = await left(app, caller(people.marco));
    expect(marco).toMatchObject({ total: 7, scope: 'visible' });
    expect(marco.kind === 'people' && marco.rows.find((r) => r.self)?.name).toBe('Marco Ruiz');
    expect(of(await left(app, caller(people.omar)))).toEqual([['Omar Haddad', '23 days left']]);
    expect(of(await left(app, caller(people.omar), { name: '@me' }))).toEqual([
      ['Omar Haddad', '23 days left'],
    ]);
    // Leo's balance is not Omar's to see, so for Omar there is nobody by that name.
    expect(await left(app, caller(people.omar), { name: 'leo' })).toEqual({
      kind: 'not_found',
      name: 'leo',
    });
    expect(of(await left(app, caller(people.marco), { name: 'leo' }))).toEqual([
      ['Leo Martin', '24.5 days left'],
    ]);
    expect(await left(app, hr, { name: '@me' })).toEqual({ kind: 'not_found', self: true });
    // Zoe is not Omar's to see, so naming her id changes nothing.
    expect(of(await left(app, caller(people.omar), { personIds: [ZOE, people.omar] }))).toEqual([
      ['Omar Haddad', '23 days left'],
    ]);
  });

  it('filters on the days left, more, fewer or exactly', async () => {
    const app = await balancesWorld();
    const over = await left(app, caller(people.marco), more('24'));
    expect(of(over).length).toBe(6);
    expect(over).toMatchObject({ described: 'with more than 24 days of Vacation left' });
    expect(
      of(await left(app, hr, { filters: [{ key: 'days_left', op: 'before', values: ['24'] }] })),
    ).toEqual([
      ['Omar Haddad', '23 days left'],
      ['Zoe Lane', '0 days left'],
    ]);
    expect(
      of(await left(app, hr, { filters: [{ key: 'days_left', op: 'is', values: ['24.5'] }] })),
    ).toEqual([['Leo Martin', '24.5 days left']]);
    const team = await left(app, hr, {
      filters: [...more('10').filters, { key: 'team', op: 'in', values: ['sales'] }],
    });
    expect(team).toMatchObject({
      total: 0,
      described: 'in Sales with more than 10 days of Vacation left',
    });
    for (const bad of [
      { key: 'days_left', op: 'after', values: ['ten'] },
      { key: 'days_left', op: 'after', values: [] },
      { key: 'days_left', op: 'in', values: ['10'] },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- each refused
      const answer = await balances(app.deps)(
        hr,
        TimeOffBalances.schemas.input.parse({ limit: 25, filters: [bad] }),
      );
      expect(answer.ok).toBe(false);
    }
  });

  it('writes a private type “Away” beside a name unless the company chose to name it', async () => {
    const app = await balancesWorld();
    const sick = { filters: [{ key: 'leave_type', op: 'in', values: ['sick'] }] };
    expect(await left(app, hr, sick)).toMatchObject({ total: 8, described: 'with a Sick balance' });
    expect(of(await left(app, hr, { filters: [...sick.filters, ...more('0').filters] }))).toEqual([
      ['Adam Novak', '3 days left'],
    ]);
    const both = { filters: [{ key: 'leave_type', op: 'in', values: ['vacation', 'Sick'] }] };
    expect(of(await left(app, caller(people.marco), { ...both, name: 'adam' }))).toEqual([
      ['Adam Novak', '3 days left · Away, 25 days left · Vacation'],
    ]);
    await setChatAnswers(app.deps)(hr, { namesPrivateLeave: true });
    expect(of(await left(app, caller(people.marco), { ...both, name: 'adam' }))).toEqual([
      ['Adam Novak', '3 days left · Sick, 25 days left · Vacation'],
    ]);
    // A teammate never sees another’s balance, of any type: only his own.
    expect(of(await left(app, caller(people.omar), sick))).toEqual([
      ['Omar Haddad', '0 days left'],
    ]);
  });

  it('counts without listing and gives every id when asked', async () => {
    const counted = await left(await balancesWorld(), hr, { limit: 0, ids: true, ...more('24') });
    expect(counted).toMatchObject({ rows: [], total: 6 });
    expect(counted.kind === 'people' && counted.ids?.length).toBe(6);
  });
});
