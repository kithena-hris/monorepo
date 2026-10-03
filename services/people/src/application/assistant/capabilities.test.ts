import { describe, expect, it } from 'vitest';
import { ok } from '@kithena/domain-kit';
import {
  PeopleApprovals,
  PeopleFind,
  PeoplePerson,
  type CapabilityOutput,
} from '@kithena/contracts';

import { utcCalendars } from '../org/org.js';
import { define, inMemoryPeople, TENANT, versionOf } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import type { Refine } from '../person/ports.js';
import type { PeopleService } from '../person/service.js';
import type { ScreenDeps } from '../screens/record.js';
import { answer, catalogue } from './capabilities.js';

/**
 * People's capabilities, answered as the asker (AST-019 to AST-021): the
 * structured answers Slack's `ask.ts` writes as sentences today, through the
 * directory's own authorization.
 */

const MICHAEL = '00000000-0000-4000-8000-0000000000d1';
const DWIGHT = '00000000-0000-4000-8000-0000000000d2';
const JIM = '00000000-0000-4000-8000-0000000000d3';
const TOBY = '00000000-0000-4000-8000-0000000000d4';
const LEFT = '00000000-0000-4000-8000-0000000000d5';
const MICHAEL_ACCOUNT = '00000000-0000-4000-8000-0000000000e1';
const JIM_ACCOUNT = '00000000-0000-4000-8000-0000000000e3';
const TOBY_ACCOUNT = '00000000-0000-4000-8000-0000000000e4';

const everyone = ['self', 'manager', 'manager_chain', 'hr', 'directory'] as const;
const attributes = [
  define({ key: 'given_name', visibility: [...everyone] }),
  define({ key: 'family_name', visibility: [...everyone] }),
  define({ key: 'job_title', visibility: [...everyone] }),
  define({
    key: 'work_email',
    dataType: 'email',
    typeConfig: { kind: 'email' },
    visibility: [...everyone],
  }),
  define({
    key: 'hire_date',
    dataType: 'date',
    typeConfig: { kind: 'date' },
    visibility: [...everyone],
  }),
  define({
    key: 'manager_id',
    dataType: 'person_ref',
    typeConfig: { kind: 'person_ref' },
    visibility: [...everyone],
  }),
  define({
    key: 'department',
    label: { default: 'Department' },
    dataType: 'select',
    typeConfig: {
      kind: 'select',
      options: [
        { value: 'sales', label: { default: 'Sales' }, retiredAt: null },
        { value: 'management', label: { default: 'Management' }, retiredAt: null },
      ],
    },
    visibility: [...everyone],
    indexed: true,
  }),
  // HR's alone to read, so HR's alone to filter by.
  define({ key: 'pay_band', visibility: ['hr'] }),
  // Never for a model.
  define({
    key: 'medical_notes',
    visibility: ['self', 'hr'],
    classification: {
      classification: 'special-category',
      piiKind: 'health',
      exportable: false,
      aiEligible: false,
    },
  }),
];

const person = (
  given: string,
  family: string,
  title: string,
  department: string,
  manager?: string,
) => ({
  fields: manager === undefined ? {} : { managerId: manager },
  custom: {
    given_name: given,
    family_name: family,
    job_title: title,
    department,
    work_email: `${given.toLowerCase()}@dunder.example`,
    ...(manager === undefined ? {} : { manager_id: manager }),
  },
});

function world(
  roles: readonly string[] = ['hr'],
  account = TOBY_ACCOUNT,
  /** People `readMany` leaves out for this asker, as if they could not read them. */
  hidden: readonly string[] = [],
) {
  const store = inMemoryPeople([versionOf(1, attributes)]);
  store.seed(MICHAEL, {
    account: MICHAEL_ACCOUNT,
    ...person('Michael', 'Scott', 'Regional Manager', 'management'),
  });
  store.seed(DWIGHT, person('Dwight', 'Schrute', 'Salesman', 'sales', MICHAEL));
  store.seed(JIM, {
    account: JIM_ACCOUNT,
    ...person('Jim', 'Halpert', 'Salesman', 'sales', MICHAEL),
  });
  store.seed(TOBY, { account: TOBY_ACCOUNT, ...person('Toby', 'Flenderson', 'HR', 'management') });
  store.seed(LEFT, { status: 'terminated', ...person('Ryan', 'Howard', 'Temp', 'sales', MICHAEL) });
  const base = personAccess(store.deps);
  /** What People was asked to run: the in-memory reader applies no conditions, only the join. */
  const asked: (Refine | undefined)[] = [];
  const lists: number[] = [];
  const access = {
    ...base,
    readMany: async (tx: never, q: Parameters<typeof base.readMany>[1]) => {
      const read = await base.readMany(tx, q);
      return read.ok ? ok(new Map([...read.value].filter(([id]) => !hidden.includes(id)))) : read;
    },
    list: (tx: never, q: Parameters<typeof base.list>[1]) => {
      asked.push(q.refine);
      lists.push(q.limit);
      return base.list(tx, q);
    },
  };
  const service: PeopleService = {
    access,
    schemas: store.deps.schemas,
    inTenant: (_tenant, fn) => fn({ tx: {} as never }),
  };
  const deps: ScreenDeps = {
    service,
    relations: store.deps.relations,
    clock: store.deps.clock,
    calendars: utcCalendars,
    personOf: (_tx, _tenant, accountId) =>
      store.deps.reader.personOf({} as never, TENANT, accountId),
    gapTotals: () => Promise.resolve({ waiting: 0, staff: [] }),
  };
  const asking = {
    tenantId: TENANT,
    viewer: { accountId: account, roles: new Set(roles) },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
  };
  const ask = async (name: string, input: unknown): Promise<CapabilityOutput> => {
    const answered = await answer(deps, asking, name, input);
    if (!answered.ok) throw new Error(`${answered.error.code}: ${answered.error.message}`);
    return answered.value;
  };
  return { deps, asking, asked, lists, ask, service };
}

const found = (output: CapabilityOutput) => {
  const parsed = PeopleFind.schemas.output.parse(output);
  if (parsed.kind !== 'people') throw new Error(`not people: ${parsed.kind}`);
  return parsed;
};

describe('people.find', () => {
  it('runs the filters as the directory does, an option read by its label', async () => {
    const w = world();
    const out = found(
      await w.ask('people.find', {
        filters: [{ key: 'department', op: 'is', values: ['Sales'] }],
        limit: 25,
      }),
    );
    expect(w.asked).toContainEqual({
      conditions: [{ key: 'department', op: 'in', values: ['sales'] }],
      match: 'all',
    });
    expect(out.described).toBe('whose department is Sales');
    expect(out.scope).toBe('everyone');
    expect(out.rows.find((r) => r.personId === DWIGHT)).toEqual({
      personId: DWIGHT,
      name: 'Dwight Schrute',
      title: 'Salesman',
      groups: {},
    });
    expect(out.total).toBe(out.rows.length);
  });

  it('counts without listing anybody when the answer is a count', async () => {
    const w = world();
    const out = found(await w.ask('people.find', { limit: 0 }));
    expect(out.rows).toEqual([]);
    expect(out.total).toBe(5);
    expect(out.described).toBe('across the company');
    expect(w.lists).toEqual([]);
  });

  it('gives each row the name of its group, for a count by department', async () => {
    const w = world();
    const out = found(await w.ask('people.find', { groupBy: 'department', limit: 5000 }));
    expect(out.rows.find((r) => r.personId === JIM)?.groups).toEqual({ department: 'Sales' });
    expect(out.rows.find((r) => r.personId === TOBY)?.groups).toEqual({ department: 'Management' });
  });

  it('orders by a field or a metric the asker may use', async () => {
    const w = world();
    await w.ask('people.find', { sort: { key: 'hire_date', direction: 'desc' }, limit: 1 });
    expect(w.asked.at(-1)?.sort).toEqual({ key: 'hire_date', direction: 'desc' });
  });

  it('is a manager’s whole team by name, or the asker’s own as @me', async () => {
    const w = world();
    const team = found(await w.ask('people.find', { name: 'Michael', limit: 25 }));
    expect(w.asked.at(-1)?.conditions).toContainEqual({
      key: 'manager_id',
      op: 'under',
      values: [MICHAEL],
    });
    expect(team.described).toBe('in Michael Scott’s team');

    const mine = world([], MICHAEL_ACCOUNT);
    await mine.ask('people.find', { name: '@me', limit: 25 });
    expect(mine.asked.at(-1)?.conditions).toEqual([
      { key: 'manager_id', op: 'under', values: [MICHAEL] },
    ]);
  });

  it('says when a name finds several people, nobody, or the asker has no record', async () => {
    const w = world();
    expect(await w.ask('people.find', { name: 'Kevin', limit: 25 })).toEqual({
      kind: 'not_found',
      name: 'Kevin',
    });
    // Every work email is at dunder.example: everybody is a candidate.
    const several = await w.ask('people.find', { name: 'Dunder', limit: 25 });
    expect(several.kind === 'ambiguous' && several.candidates.length).toBe(5);
    expect(several.kind === 'ambiguous' && several.candidates).toContainEqual({
      personId: JIM,
      name: 'Jim Halpert',
      title: 'Salesman',
    });
    const stranger = world(['hr'], '00000000-0000-4000-8000-0000000000ff');
    expect(await stranger.ask('people.find', { name: '@me', limit: 25 })).toEqual({
      kind: 'not_found',
      self: true,
    });
  });

  it('refuses a field the asker may not filter by, or one not for AI, rather than guessing', async () => {
    const employee = world([], JIM_ACCOUNT);
    for (const key of ['pay_band', 'medical_notes', 'salary']) {
      const refused = await answer(employee.deps, employee.asking, 'people.find', {
        filters: [{ key, op: 'contains', values: ['x'] }],
        limit: 25,
      });
      expect(!refused.ok && refused.error.code).toBe('BAD_REQUEST');
    }
    // A plan may not set the join, but the module still reads its own input strictly.
    const extra = await answer(employee.deps, employee.asking, 'people.find', {
      limit: 25,
      everybody: true,
    });
    expect(!extra.ok && extra.error.code).toBe('BAD_REQUEST');
  });

  it('gives every id when a later step needs them', async () => {
    const w = world();
    const out = found(await w.ask('people.find', { limit: 0, ids: true }));
    expect(out.ids?.toSorted()).toEqual([MICHAEL, DWIGHT, JIM, TOBY, LEFT].toSorted());
    expect(out.rows).toEqual([]);
  });

  it('narrowed to personIds, never returns somebody the asker could not list without them', async () => {
    // An employee's directory has no leavers in it; HR's does.
    const employee = world([], JIM_ACCOUNT);
    const narrowed = found(
      await employee.ask('people.find', { personIds: [LEFT, DWIGHT], limit: 25, ids: true }),
    );
    expect(narrowed.rows.map((r) => r.personId)).toEqual([DWIGHT]);
    expect(narrowed.ids).toEqual([DWIGHT]);
    expect(narrowed.total).toBe(1);
    const unrestricted = found(await employee.ask('people.find', { limit: 25 }));
    expect(unrestricted.rows.map((r) => r.personId)).not.toContain(LEFT);

    const hr = found(await world().ask('people.find', { personIds: [LEFT, DWIGHT], limit: 25 }));
    expect(hr.rows.map((r) => r.personId).toSorted()).toEqual([DWIGHT, LEFT].toSorted());
    expect(found(await world().ask('people.find', { personIds: [], limit: 25 })).total).toBe(0);
  });
});

describe('people.person', () => {
  it('is one person as the asker may read them: job, manager, start date and work email', async () => {
    const out = PeoplePerson.schemas.output.parse(
      await world([], MICHAEL_ACCOUNT).ask('people.person', { name: 'Jim' }),
    );
    expect(out).toEqual({
      kind: 'profile',
      personId: JIM,
      name: 'Jim Halpert',
      title: 'Salesman',
      manager: 'Michael Scott',
      // The hire's own date, from the record.
      hireDate: '2026-01-01',
      email: 'jim@dunder.example',
      self: false,
    });
  });

  it('reads "me" as whoever is asking, and says so when they have no record', async () => {
    const mine = await world([], JIM_ACCOUNT).ask('people.person', { name: '@me' });
    expect(mine).toMatchObject({ kind: 'profile', personId: JIM, self: true });
    const stranger = world([], '00000000-0000-4000-8000-0000000000ff');
    expect(await stranger.ask('people.person', { name: '@me' })).toEqual({
      kind: 'not_found',
      self: true,
    });
  });

  it('asks which one when a name finds several, and says nobody when it finds none', async () => {
    const w = world();
    expect((await w.ask('people.person', { name: 'Dunder' })).kind).toBe('ambiguous');
    expect(await w.ask('people.person', { name: 'Kevin' })).toEqual({
      kind: 'not_found',
      name: 'Kevin',
    });
  });

  it('takes a name and nothing else', async () => {
    const w = world();
    const refused = await answer(w.deps, w.asking, 'people.person', {});
    expect(!refused.ok && refused.error.code).toBe('BAD_REQUEST');
  });
});

describe('people.reports', () => {
  it('is who reports directly to somebody found by name, as the directory lists them', async () => {
    // An employee's directory has no leavers: Ryan reported to Michael, and has left.
    const out = found(
      await world([], JIM_ACCOUNT).ask('people.reports', { name: 'Michael', limit: 25 }),
    );
    expect(out.rows.map((r) => r.name).toSorted()).toEqual(['Dwight Schrute', 'Jim Halpert']);
    expect(out.total).toBe(2);
    expect(out.described).toBe('reporting directly to Michael Scott');
  });

  it('reads "me" as whoever is asking', async () => {
    const out = found(
      await world([], MICHAEL_ACCOUNT).ask('people.reports', { name: '@me', limit: 25 }),
    );
    expect(out.total).toBe(2);
    const stranger = world([], '00000000-0000-4000-8000-0000000000ff');
    expect(await stranger.ask('people.reports', { name: '@me', limit: 25 })).toEqual({
      kind: 'not_found',
      self: true,
    });
  });

  it('asks which one when a name finds several', async () => {
    const out = await world().ask('people.reports', { name: 'Dunder', limit: 25 });
    expect(out.kind).toBe('ambiguous');
  });
});

describe('people.approvals', () => {
  it('is the asker’s inbox: empty where nothing waits', async () => {
    const out = PeopleApprovals.schemas.output.parse(
      await world().ask('people.approvals', { limit: 25 }),
    );
    expect(out).toEqual({ kind: 'items', items: [], total: 0 });
  });
});

describe('people.managers', () => {
  it('lists two reports’ one manager once, with no count of reports', async () => {
    const out = found(
      await world([], JIM_ACCOUNT).ask('people.managers', {
        personIds: [DWIGHT, JIM],
        limit: 25,
        ids: true,
      }),
    );
    expect(out.rows).toEqual([
      { personId: MICHAEL, name: 'Michael Scott', title: 'Regional Manager', groups: {} },
    ]);
    expect(out.ids).toEqual([MICHAEL]);
    expect(out.total).toBe(1);
  });

  it('leaves out a manager the asker may not read', async () => {
    const out = found(
      await world([], JIM_ACCOUNT, [MICHAEL]).ask('people.managers', {
        personIds: [DWIGHT, JIM],
        limit: 25,
      }),
    );
    expect(out.rows).toEqual([]);
    expect(out.total).toBe(0);
  });

  it('leaves out the people the asker may not read, and so their managers', async () => {
    const out = found(
      await world([], JIM_ACCOUNT, [DWIGHT, JIM]).ask('people.managers', {
        personIds: [DWIGHT, JIM],
        limit: 25,
      }),
    );
    expect(out.total).toBe(0);
  });

  it('has nobody to list for somebody with no manager', async () => {
    const w = world();
    expect(found(await w.ask('people.managers', { personIds: [TOBY], limit: 25 })).total).toBe(0);
    const some = found(await w.ask('people.managers', { personIds: [TOBY, JIM], limit: 25 }));
    expect(some.rows.map((r) => r.personId)).toEqual([MICHAEL]);
  });

  it('means nothing without the people of an earlier step', async () => {
    const w = world();
    const refused = await answer(w.deps, w.asking, 'people.managers', { limit: 25 });
    expect(!refused.ok && refused.error.code).toBe('BAD_REQUEST');
  });
});

describe('the catalogue', () => {
  it('serves people.find with the asker’s fields, and denies what is not for AI', async () => {
    const w = world([], JIM_ACCOUNT);
    const c = await catalogue(w.deps, w.asking);
    expect(c.ok && c.value.serves).toEqual([
      { name: 'people.find', version: 1 },
      { name: 'people.person', version: 1 },
      { name: 'people.reports', version: 1 },
      { name: 'people.managers', version: 1 },
      { name: 'people.approvals', version: 1 },
    ]);
    const keys = c.ok ? (c.value.fields['people.find'] ?? []).map((f) => f.key) : [];
    expect(keys).toContain('department');
    expect(keys).not.toContain('pay_band');
    expect(keys).not.toContain('medical_notes');
    expect(c.ok && c.value.denied).toContainEqual({
      key: 'medical_notes',
      labels: ['medical_notes'],
    });
  });
});
