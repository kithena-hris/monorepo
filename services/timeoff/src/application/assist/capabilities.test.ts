import { describe, expect, it } from 'vitest';
import {
  DateSpan,
  LeaveTypeDefinition,
  LeaveTypeKey,
  PersonId,
  RuntimeCatalogue,
  TeamKey,
  TimeOffAway,
  TimeOffManagers,
  type CapabilityInput,
} from '@kithena/contracts';

import { LeaveType } from '../../domain/policy/leave-type.js';
import { decideRequest } from '../approval/decide.js';
import type { Caller } from '../ports.js';
import { sendRequest } from '../request/request.js';
import {
  caller,
  hr,
  MADRID,
  member,
  people,
  PLATFORM,
  TENANT,
  vacationType,
  world,
} from '../testing/world.js';
import { away, capabilityCatalogue, managers } from './capabilities.js';

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
    ]);
    expect(catalogue.leaveTypes).toEqual([
      { key: 'sick', name: 'Sick', private: true },
      { key: 'vacation', name: 'Vacation', private: false },
    ]);
    const fields = catalogue.fields['timeoff.away'] ?? [];
    expect(fields.map((f) => f.key)).toEqual(['leave_type', 'team']);
    // A private type is never an option by name: the assistant offers it only masked (§12.2).
    expect(fields[0]?.options).toEqual([{ value: 'vacation', label: 'Vacation' }]);
    expect(fields[1]?.options).toEqual([{ value: 'platform', label: 'Platform' }]);
    expect(catalogue.denied.find((d) => d.key === 'sick_note')?.labels).toContain('sick leave');
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
    });
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
    TimeOffAway.schemas.input.parse({ on: TUESDAY, limit: 25, ...input }) as CapabilityInput,
  );
  if (!answer.ok) throw new Error(answer.error.message);
  return TimeOffAway.schemas.output.parse(answer.value);
}

const lines = (result: Awaited<ReturnType<typeof ask>>) =>
  result.kind === 'people' ? result.rows.map((r) => [r.name, r.detail]) : result.kind;
const sick = { filters: [{ key: 'leave_type', op: 'in', values: ['sick'] }] };

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
    const team = (values: string[]) => ({ filters: [{ key: 'team', op: 'in', values }] });
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

  async function managersOf(app: App, who: Caller, personIds: PersonId[], limit = 25) {
    const answer = await managers(app.deps)(
      who,
      TimeOffManagers.schemas.input.parse({ personIds, limit, ids: true }) as CapabilityInput,
    );
    if (!answer.ok) throw new Error(answer.error.message);
    return TimeOffManagers.schemas.output.parse(answer.value);
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
