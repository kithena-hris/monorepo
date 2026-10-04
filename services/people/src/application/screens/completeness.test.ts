import { describe, expect, it } from 'vitest';

import { fixedCalendars, utcCalendars } from '../org/org.js';
import { define, inMemoryPeople, TENANT, versionOf } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import type { PeopleService } from '../person/service.js';
import { completenessView, remindWaiting, saveGrid } from './people.js';
import type { GapFigures, ScreenDeps } from './record.js';

/**
 * Data health's Completeness tab (V4, MV2): who is missing what, whoever
 * fills it in, and the figures beside it. Nothing here is a number People
 * does not have: a figure its store cannot answer is null, not zero.
 */

const MEI = '00000000-0000-4000-8000-0000000000a1';
const OMAR = '00000000-0000-4000-8000-0000000000a2';
const HR_ACCOUNT = '00000000-0000-4000-8000-0000000000b9';

const attributes = [
  define({ key: 'given_name', visibility: ['self', 'hr', 'directory'] }),
  define({ key: 'family_name', visibility: ['self', 'hr', 'directory'] }),
  // HR's to fill in.
  define({ key: 'cost_centre', requiredness: { mode: 'always' } }),
  // Theirs to give.
  define({
    key: 'emergency_contact',
    ownership: ['employee'],
    collectAt: 'onboarding',
    requiredness: { mode: 'always' },
  }),
  // Theirs, and payroll cannot pay them without it.
  define({
    key: 'iban',
    ownership: ['employee'],
    collectAt: 'onboarding',
    requiredness: { mode: 'always' },
    dataType: 'bank_account',
    typeConfig: { kind: 'bank_account', country: 'ES' },
  }),
];

const ENTITY = '00000000-0000-4000-8000-0000000000e1';
const ORG = {
  defaultZone: 'Europe/Madrid',
  entities: new Map([
    [ENTITY, { id: ENTITY, name: 'Acme Iberia SL', country: 'ES', timeZone: 'Europe/Madrid' }],
    [
      'gone',
      { id: 'gone', name: 'Old Co', country: 'ES', timeZone: 'Europe/Madrid', archived: true },
    ],
  ]),
  locations: new Map([
    [
      'loc-mad',
      {
        id: 'loc-mad',
        legalEntityId: ENTITY,
        name: 'Madrid',
        country: 'ES',
        zones: [{ effectiveFrom: '2020-01-01', timeZone: 'Europe/Madrid' }],
      },
    ],
  ]),
} as never;

function world(
  options: {
    figures?: boolean;
    sweep?: boolean;
    extra?: readonly ReturnType<typeof define>[];
    staff?: readonly { key: string; people: number }[];
    org?: boolean;
  } = {},
) {
  const store = inMemoryPeople([versionOf(1, [...attributes, ...(options.extra ?? [])])]);
  // Mei owes HR a cost centre and herself an emergency contact and a bank account.
  store.seed(MEI, { custom: { given_name: 'Mei', family_name: 'Tanaka' } });
  // Omar owes nothing HR fills in, only his own details.
  store.seed(OMAR, {
    custom: { given_name: 'Omar', family_name: 'Haddad', cost_centre: 'CC-1' },
  });
  const access = personAccess(store.deps);
  const service: PeopleService = {
    access,
    schemas: store.deps.schemas,
    inTenant: (_tenant, fn) => fn({ tx: {} as never }),
    pending: undefined as never,
  };
  const asked: { payroll: readonly string[]; people: readonly string[] }[] = [];
  const swept: string[] = [];
  const figures: GapFigures = {
    blocking: 4,
    lastReminded: '2026-09-21T08:00:00.000Z',
    due: 61,
    remindedAt: new Map([[OMAR, '2026-09-20T09:00:00.000Z']]),
  };
  const deps: ScreenDeps = {
    service,
    relations: store.deps.relations,
    clock: store.deps.clock,
    calendars: options.org === true ? fixedCalendars(ORG) : utcCalendars,
    personOf: () => Promise.resolve(null),
    gapTotals: () =>
      Promise.resolve({
        waiting: 70,
        staff: options.staff ?? [{ key: 'cost_centre', people: 1 }],
      }),
    ...(options.figures === false
      ? {}
      : {
          gapFigures: (_tx, _tenant, ask) => {
            asked.push({ payroll: ask.payroll, people: ask.people });
            return Promise.resolve(figures);
          },
        }),
    ...(options.sweep === false
      ? {}
      : {
          remindNow: (tenantId: string) => {
            swept.push(tenantId);
            return Promise.resolve({ sent: 5, failed: 1, waiting: false });
          },
        }),
  };
  const as = (accountId: string, ...roles: string[]) => ({
    tenantId: TENANT,
    viewer: { accountId, roles: new Set(roles) },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
  });
  return { deps, as, asked, swept };
}

describe('the completeness view', () => {
  it('lists a row for each owner of what a person is missing', async () => {
    const w = world();
    const view = await completenessView(w.deps, w.as(HR_ACCOUNT, 'hr'));
    if (!view.ok) throw new Error(view.error.message);
    expect(view.value.rows.map((r) => [r.name, r.owner, r.missing, r.remindedAt])).toEqual([
      ['Mei Tanaka', 'hr', ['cost_centre'], null],
      ['Mei Tanaka', 'employee', ['emergency_contact', 'iban'], null],
      ['Omar Haddad', 'employee', ['emergency_contact', 'iban'], '2026-09-20T09:00:00.000Z'],
    ]);
    // Every missing key has a label to show, the employee's too.
    expect(view.value.fields.map((f) => f.key).toSorted()).toEqual([
      'cost_centre',
      'emergency_contact',
      'iban',
    ]);
  });

  it('asks for payroll by the fields that block it, and the reminders of the people listed', async () => {
    const w = world();
    await completenessView(w.deps, w.as(HR_ACCOUNT, 'hr'));
    expect(w.asked).toEqual([{ payroll: ['iban'], people: [MEI, OMAR] }]);
  });

  it('carries the store’s figures: blocking payroll, the last reminder, and who is due', async () => {
    const w = world();
    const view = await completenessView(w.deps, w.as(HR_ACCOUNT, 'hr'));
    if (!view.ok) throw new Error(view.error.message);
    expect(view.value.blocking).toBe(4);
    expect(view.value.waiting).toEqual({
      people: 70,
      lastReminded: '2026-09-21T08:00:00.000Z',
      due: 61,
    });
    expect(view.value.toFill).toBe(1);
  });

  it('shows no figure it cannot answer, rather than a zero', async () => {
    const w = world({ figures: false });
    const view = await completenessView(w.deps, w.as(HR_ACCOUNT, 'hr'));
    if (!view.ok) throw new Error(view.error.message);
    expect(view.value.blocking).toBeNull();
    expect(view.value.waiting).toEqual({ people: 70, lastReminded: null, due: null });
    expect(view.value.rows.every((r) => r.remindedAt === null)).toBe(true);
  });

  it('says what kind of value each field takes, so the grid draws its own control for it', async () => {
    const w = world({
      extra: [
        define({ key: 'contract_end', dataType: 'date', typeConfig: { kind: 'date', range: 'any' } }),
        define({ key: 'allowance', dataType: 'money', typeConfig: { kind: 'money', currency: 'EUR' } }),
        define({
          key: 'equipment',
          dataType: 'multi_select',
          typeConfig: {
            kind: 'multi_select',
            options: [{ value: 'laptop', label: { default: 'Laptop' } }],
          },
        }),
        // Finance's alone: not HR's to fill in, nor counted as HR's.
        define({ key: 'payroll_ref', ownership: ['finance'] }),
      ],
      staff: [
        { key: 'allowance', people: 2 },
        { key: 'contract_end', people: 3 },
        { key: 'cost_centre', people: 1 },
        { key: 'equipment', people: 4 },
        { key: 'payroll_ref', people: 9 },
      ],
    });
    const view = await completenessView(w.deps, w.as(HR_ACCOUNT, 'hr'));
    if (!view.ok) throw new Error(view.error.message);
    const field = (key: string) => view.value.fields.find((f) => f.key === key);
    expect(field('contract_end')).toMatchObject({ dataType: 'date', currency: null, options: [] });
    expect(field('allowance')).toMatchObject({ dataType: 'money', currency: 'EUR' });
    expect(field('equipment')).toMatchObject({
      dataType: 'multi_select',
      options: [{ value: 'laptop', label: 'Laptop' }],
    });
    expect(field('cost_centre')).toMatchObject({ dataType: 'text', person: false });
    expect(field('payroll_ref')).toBeUndefined();
    expect(view.value.toFill).toBe(10);
  });

  it('gives every list-backed field its choices: codes from the standard lists, places from the company', async () => {
    const plain = (key: string, kind: string) =>
      define({ key, dataType: kind as never, typeConfig: { kind } as never });
    const w = world({
      org: true,
      extra: [
        plain('nationality', 'country'),
        plain('pay_currency', 'currency'),
        plain('first_language', 'language'),
        plain('home_zone', 'time_zone'),
        plain('entity', 'legal_entity_ref'),
        plain('office', 'location_ref'),
      ],
      staff: ['nationality', 'pay_currency', 'first_language', 'home_zone', 'entity', 'office'].map(
        (key) => ({ key, people: 1 }),
      ),
    });
    const view = await completenessView(w.deps, w.as(HR_ACCOUNT, 'hr'));
    if (!view.ok) throw new Error(view.error.message);
    const options = (key: string) => view.value.fields.find((f) => f.key === key)?.options ?? [];
    // Every country, not only the ones People has address rules for.
    expect(options('nationality')).toContainEqual({ value: 'FR', label: 'France' });
    expect(options('nationality')).toContainEqual({ value: 'JP', label: 'Japan' });
    expect(options('nationality').length).toBeGreaterThan(240);
    // Not a region that is not a country.
    expect(options('nationality').map((o) => o.value)).not.toContain('EU');
    expect(options('pay_currency')).toContainEqual({ value: 'EUR', label: 'Euro (EUR)' });
    expect(options('first_language')).toContainEqual({ value: 'fr', label: 'French' });
    expect(options('home_zone')).toContainEqual({ value: 'Europe/Madrid', label: 'Europe/Madrid' });
    // The company's own, the archived one left out.
    expect(options('entity')).toEqual([{ value: ENTITY, label: 'Acme Iberia SL' }]);
    expect(options('office')).toEqual([{ value: 'loc-mad', label: 'Madrid' }]);
  });

  it('saves any country offered, not only one with address rules', async () => {
    const w = world({
      extra: [define({ key: 'nationality', dataType: 'country', typeConfig: { kind: 'country' } })],
    });
    const saved = await saveGrid(w.deps, w.as(HR_ACCOUNT, 'hr'), [
      { personId: MEI, values: { nationality: 'JP' } },
    ]);
    expect(saved.ok ? 'saved' : saved.error.message).toBe('saved');
  });

  it('reads one person’s gaps alone, for the fill-in a link opens', async () => {
    const w = world();
    const view = await completenessView(w.deps, w.as(HR_ACCOUNT, 'hr'), { person: OMAR });
    if (!view.ok) throw new Error(view.error.message);
    expect(view.value.rows.map((r) => [r.personId, r.owner])).toEqual([[OMAR, 'employee']]);
    expect(view.value.next).toBeNull();
    // The totals are everybody's still.
    expect(view.value.waiting.people).toBe(70);
  });

  it('offers nobody to remind where the sweep cannot run from here', async () => {
    const w = world({ sweep: false });
    const view = await completenessView(w.deps, w.as(HR_ACCOUNT, 'hr'));
    expect(view.ok && view.value.waiting.due).toBeNull();
  });
});

describe('reminding everybody who is waiting, now', () => {
  it('runs the weekly sweep for the tenant, and says who was sent one and who was not due', async () => {
    const w = world();
    const outcome = await remindWaiting(w.deps, w.as(HR_ACCOUNT, 'hr'));
    expect(w.swept).toEqual([TENANT]);
    // 70 waiting, 5 sent, 1 lost in sending: 64 were not due yet.
    expect(outcome).toEqual({ ok: true, value: { sent: 5, failed: 1, skipped: 64 } });
  });

  it('is HR’s alone', async () => {
    const w = world();
    const outcome = await remindWaiting(w.deps, w.as(HR_ACCOUNT));
    expect(outcome.ok ? 'sent' : outcome.error.code).toBe('FORBIDDEN');
    expect(w.swept).toEqual([]);
  });

  it('is unavailable where the sweep is not wired', async () => {
    const w = world({ sweep: false });
    const outcome = await remindWaiting(w.deps, w.as(HR_ACCOUNT, 'hr'));
    expect(outcome.ok ? 'sent' : outcome.error.code).toBe('UNAVAILABLE');
  });
});
