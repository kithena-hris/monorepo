import type { CalendarDate } from '@kithena/contracts';
import { describe, expect, it } from 'vitest';

import { noTransaction as tx } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import { cellFindings, dryRun, rowNamesOf, type ClassifiedRow } from './dry-run.js';
import { asking, attributes, csv, HEADERS, HR, priyasRows, priyasTenant } from './fixture.js';
import { define, versionOf } from '../person/in-memory.js';
import { UTC_CALENDAR } from '../../domain/org/calendar.js';
import { proposeMapping, resolveMapping } from './mapping.js';
import { parseUpload } from './parse.js';
import { fixedCalendars, utcCalendars } from '../org/org.js';

const HR_RELATIONS = {
  isSelf: false,
  isManager: false,
  isInManagerChain: false,
  isHr: true,
  isFinance: false,
  isAdmin: false,
};

async function run(bytes: Uint8Array) {
  const store = priyasTenant();
  const deps = {
    calendars: utcCalendars,
    access: personAccess(store.deps),
    schemas: store.deps.schemas,
    relations: store.deps.relations,
    clock: store.deps.clock,
  };
  const file = await parseUpload(bytes);
  if (!file.ok) throw new Error(file.error.message);
  const version = store.versions[0];
  if (!version) throw new Error('no version');
  const proposed = await proposeMapping({
    file: file.value,
    version,
    relations: HR_RELATIONS,
    advisor: null,
  });
  const mapping = resolveMapping(proposed, {}, version, HR_RELATIONS);
  if (!mapping.ok) throw new Error(mapping.error.message);
  const before = {
    rows: store.rows.size,
    history: store.history.length,
    events: store.events.length,
  };
  const result = await dryRun(tx, deps, { ...asking, file: file.value, mapping: mapping.value });
  return { store, before, result, mapping: mapping.value };
}

describe('Priya’s 412 rows (PRD §14.4)', () => {
  it('produce exactly the counts §14.4 prints, and nothing is written', async () => {
    const { store, before, result } = await run(csv(HEADERS, priyasRows()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dry = result.value;

    expect(dry.rowsRead).toBe(412);
    expect(dry.counts).toEqual({
      // §14.4's 14 blocked rows import now: nothing blocks a row that is somebody.
      create: 382,
      update: 21,
      unchanged: 4,
      blocked: 0,
      duplicate: 5,
    });
    expect(dry.blockedBy).toEqual({});
    // 3 unreadable hire dates, and 11 that wait for a work email: each named for HR.
    expect(dry.leftEmpty.filter((l) => l.key === 'hire_date')).toHaveLength(14);
    expect(dry.incomplete).toEqual({ count: 88, byKey: { cost_centre: 61, home_address: 27 } });
    expect(
      dry.rows
        .filter((r: ClassifiedRow) => r.outcome === 'update')
        .every((r: ClassifiedRow) => r.matchedOn === 'work_email'),
    ).toBe(true);

    expect({
      rows: store.rows.size,
      history: store.history.length,
      events: store.events.length,
    }).toEqual(before);
  });
});

describe('the three outcomes, one at a time', () => {
  const row = (over: Record<string, string>) => HEADERS.map((h) => over[h] ?? '');
  const good = {
    'Given name': 'Ana',
    'Family name': 'Ruiz',
    'Work email': 'ana@acme.test',
    'Hire date': '2026-03-01',
    'Cost centre': 'CC-2',
    Country: 'GB',
  };

  it('a missing family name still imports: only a row with no name and no email is skipped', async () => {
    const nobody = row({ 'Hire date': '2026-03-01', 'Cost centre': 'CC-2' });
    const { result } = await run(csv(HEADERS, [row({ ...good, 'Family name': '' }), nobody]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows.map((r: ClassifiedRow) => r.outcome)).toEqual(['create', 'blocked']);
    expect(result.value.rows[1]?.problems).toEqual([
      expect.objectContaining({ reason: 'no name and no work email: nobody to create' }),
    ]);
  });

  it('missing any other required field imports, incomplete', async () => {
    const { result } = await run(csv(HEADERS, [row({ ...good, 'Cost centre': '' })]));
    const only = result.ok ? result.value.rows[0] : undefined;
    expect(only?.outcome).toBe('create');
    expect(only?.missing).toEqual(['cost_centre']);
    expect(result.ok && result.value.incomplete.count).toBe(1);
  });

  it('a future start imports a pre-hire, asked only for what a pre-hire is (§8.1)', async () => {
    // Cost centre is HR-only: it waits for the start date, so the dry run
    // counts it as the record will, not as it would for somebody active.
    const { result } = await run(
      csv(HEADERS, [row({ ...good, 'Cost centre': '', 'Hire date': '2026-12-01' })]),
    );
    const only = result.ok ? result.value.rows[0] : undefined;
    expect(only?.outcome).toBe('create');
    expect(only?.missing).toEqual([]);
    expect(result.ok && result.value.incomplete.count).toBe(0);
  });

  it('an invalid value is left empty for HR, naming the cell; the row imports', async () => {
    const { result } = await run(
      csv(HEADERS, [
        row(good),
        row({ ...good, 'Work email': 'b@acme.test', 'Date of birth': '2090-01-01' }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows.map((r: ClassifiedRow) => r.outcome)).toEqual(['create', 'create']);
    expect(result.value.rows[1]?.changes).not.toHaveProperty('date_of_birth');
    expect(result.value.leftEmpty).toEqual([
      expect.objectContaining({
        row: 3,
        column: 'Date of birth',
        key: 'date_of_birth',
        value: '2090-01-01',
      }),
    ]);
  });

  it('never drops an existing person’s new hire date silently: with no field to correct, it is listed for HR', async () => {
    // Priya's tenant publishes no hire_date, so there is nothing to correct
    // through and no overwrite to fall back on (§8.5, PEO-090).
    const { result } = await run(
      csv(HEADERS, [
        row({
          'Given name': 'Existing1',
          'Family name': 'Person',
          'Work email': 'e1@acme.test',
          'Hire date': '2025-06-01',
        }),
      ]),
    );
    const only = result.ok ? result.value.rows[0] : undefined;
    expect(only?.outcome).not.toBe('blocked');
    expect(only?.hireDateCorrection).toBeNull();
    expect(only?.leftEmpty).toEqual([
      expect.objectContaining({ key: 'hire_date', column: 'Hire date', value: '2025-06-01' }),
    ]);
  });

  it('leaves an ambiguous date empty unless told the file’s order: provisional until HR sets it', async () => {
    const { result } = await run(csv(HEADERS, [row({ ...good, 'Hire date': '03/04/2026' })]));
    const only = result.ok ? result.value.rows[0] : undefined;
    expect(only?.outcome).toBe('create');
    expect(only?.hireDate).toBeNull();
    expect(only?.leftEmpty.map((l) => l.key)).toEqual(['hire_date']);
  });
});

describe('a legal entity the schema asks for (PEO-123)', () => {
  const ES = '00000000-0000-4000-8000-0000000000e1';
  const PT = '00000000-0000-4000-8000-0000000000e2';
  const entity = (id: string) => ({ id, name: id, country: 'ES', timeZone: 'Europe/Madrid' });
  const row = HEADERS.map(
    (h) =>
      ({
        'Given name': 'Ana',
        'Family name': 'Ruiz',
        'Work email': 'ana@acme.test',
        'Hire date': '2026-03-01',
      })[h] ?? '',
  );

  async function withEntities(ids: readonly string[]) {
    const store = priyasTenant();
    store.versions.push(
      versionOf(2, [
        ...attributes,
        define({
          key: 'legal_entity_id',
          dataType: 'legal_entity_ref',
          typeConfig: { kind: 'legal_entity_ref' },
        }),
      ]),
    );
    const file = await parseUpload(csv(HEADERS, [row]));
    if (!file.ok) throw new Error(file.error.message);
    const version = store.versions.at(-1);
    if (!version) throw new Error('no version');
    const proposed = await proposeMapping({
      file: file.value,
      version,
      relations: HR_RELATIONS,
      advisor: null,
    });
    const mapping = resolveMapping(proposed, {}, version, HR_RELATIONS);
    if (!mapping.ok) throw new Error(mapping.error.message);
    const result = await dryRun(
      tx,
      {
        calendars: fixedCalendars({
          ...UTC_CALENDAR,
          entities: new Map(ids.map((id) => [id, entity(id)])),
        }),
        access: personAccess(store.deps),
        schemas: store.deps.schemas,
        relations: store.deps.relations,
        clock: store.deps.clock,
      },
      { ...asking, file: file.value, mapping: mapping.value },
    );
    return result.ok ? result.value.rows[0] : undefined;
  }

  it('takes the company’s only entity for a new person with none', async () => {
    const only = await withEntities([ES]);
    expect(only?.outcome).toBe('create');
    expect(only?.changes).toMatchObject({ legal_entity_id: ES });
  });

  it('imports without one when there is more than one to choose from, for HR to set', async () => {
    const only = await withEntities([ES, PT]);
    expect(only?.outcome).toBe('create');
    expect(only?.changes).not.toHaveProperty('legal_entity_id');
  });
});

describe('who may run it', () => {
  it('refuses a mapping that routes a column to a field the importer may not write', async () => {
    const store = priyasTenant();
    const deps = {
      calendars: utcCalendars,
      access: personAccess(store.deps),
      schemas: store.deps.schemas,
      relations: store.deps.relations,
      clock: store.deps.clock,
    };
    const file = await parseUpload(csv(['Work email'], [['x@acme.test']]));
    if (!file.ok) return;
    const forged = [
      {
        index: 0,
        header: 'Work email',
        status: 'mapped' as const,
        key: 'no_such_field',
        source: 'manual' as const,
        confidence: null,
        reason: null,
      },
    ];
    const result = await dryRun(tx, deps, { ...asking, file: file.value, mapping: forged });
    expect(!result.ok && result.error.code).toBe('FIELD_NOT_WRITABLE');

    const notHr = await dryRun(tx, deps, {
      ...asking,
      viewer: { ...HR, roles: new Set(['finance']) },
      file: file.value,
      mapping: [],
    });
    expect(!notHr.ok && notHr.error.code).toBe('FORBIDDEN');
  });
});

describe('doubted national identifiers in a file (PEO-125; PRD §14.5)', () => {
  const nif = define({
    key: 'es_nif',
    dataType: 'national_id',
    typeConfig: { kind: 'national_id', country: 'ES', scheme: 'nif' },
  });
  const version = versionOf(1, [nif]);
  const mapping = [
    { index: 0, header: 'NIF', status: 'mapped', key: 'es_nif' },
  ] as unknown as Parameters<typeof cellFindings>[1];
  const row = (n: number, outcome: ClassifiedRow['outcome'], value: string) =>
    ({ row: n, outcome, personId: null, changes: { es_nif: value } }) as unknown as ClassifiedRow;

  it('lists each doubted cell by row and column, never the value, and blocks nothing', () => {
    const found = cellFindings(version, mapping, [
      row(2, 'create', '12345678Z'),
      row(3, 'create', '12345678A'),
      row(4, 'update', 'B12345678'),
      row(5, 'blocked', '12345678A'),
    ]);
    expect(found).toEqual([
      expect.objectContaining({
        row: 3,
        column: 'NIF',
        key: 'es_nif',
        level: 'mismatch',
        code: 'check_mismatch',
      }),
      expect.objectContaining({
        row: 4,
        column: 'NIF',
        level: 'attention',
        code: 'holder_not_person',
      }),
    ]);
    expect(JSON.stringify(found)).not.toContain('12345678A');
  });
});

describe('each row named for HR', () => {
  it('by the name on it, else its work email, so a listed cell says whose it is', async () => {
    const bytes = csv(
      ['given_name', 'family_name', 'work_email', 'hire_date'],
      [
        ['Pam', 'Beesly', 'pam@acme.example', '2025-01-06'],
        ['', '', 'ines@acme.example', 'not a date'],
        ['', '', '', ''],
      ],
    );
    const { result, mapping } = await run(bytes);
    const file = await parseUpload(bytes);
    if (!result.ok || !file.ok) throw new Error('no dry run');
    const names = rowNamesOf(file.value, mapping);
    expect([...names.values()]).toEqual(['Pam Beesly', 'ines@acme.example']);
    const [ines] = result.value.leftEmpty.filter((l) => l.key === 'hire_date');
    expect(ines !== undefined && names.get(ines.row)).toBe('ines@acme.example');
  });
});

describe('work locations chosen in the import', () => {
  const ES = '00000000-0000-4000-8000-0000000000e1';
  const MADRID = '00000000-0000-4000-8000-0000000000f1';
  const OTHER_ID = '01a0e1d1-f26f-7000-be34-a7236a53ad47';
  const headers = ['Given name', 'Family name', 'Work email', 'Hire date', 'location_id'];
  const rows = [
    ['Ana', 'Ruiz', 'ana@acme.test', '2026-03-01', 'Madrid'],
    ['Bea', 'Sol', 'bea@acme.test', '2026-03-01', 'Lisbon'],
    ['Carl', 'Mora', 'carl@acme.test', '2026-03-01', OTHER_ID],
    ['Dani', 'Gil', 'dani@acme.test', '2026-03-01', 'lisbon'],
  ];

  async function plan(
    places?: Parameters<typeof dryRun>[2]['places'],
    file_: { headers: string[]; rows: string[][] } = { headers, rows },
  ) {
    const store = priyasTenant();
    store.versions.push(
      versionOf(2, [
        ...attributes,
        define({
          key: 'location_id',
          dataType: 'location_ref',
          typeConfig: { kind: 'location_ref' },
        }),
      ]),
    );
    const file = await parseUpload(csv(file_.headers, file_.rows));
    const version = store.versions.at(-1);
    if (!file.ok || !version) throw new Error('no file');
    const proposed = await proposeMapping({
      file: file.value,
      version,
      relations: HR_RELATIONS,
      advisor: null,
    });
    const mapping = resolveMapping(proposed, {}, version, HR_RELATIONS);
    if (!mapping.ok) throw new Error(mapping.error.message);
    const result = await dryRun(
      tx,
      {
        calendars: fixedCalendars({
          ...UTC_CALENDAR,
          entities: new Map([
            [ES, { id: ES, name: 'Acme ES', country: 'ES', timeZone: 'Europe/Madrid' }],
          ]),
          locations: new Map([
            [
              MADRID,
              {
                id: MADRID,
                legalEntityId: ES,
                name: 'Madrid HQ',
                country: 'ES',
                zones: [{ effectiveFrom: '2020-01-01' as CalendarDate, timeZone: 'Europe/Madrid' }],
              },
            ],
          ]),
        }),
        access: personAccess(store.deps),
        schemas: store.deps.schemas,
        relations: store.deps.relations,
        clock: store.deps.clock,
      },
      { ...asking, file: file.value, mapping: mapping.value, ...(places ? { places } : {}) },
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }

  it('lists each value with its people, and proposes what to do with it', async () => {
    const dry = await plan();
    expect(
      dry.workplaces.map((w) => [w.value, w.rows, w.people, w.proposed.kind, w.suggestion?.name]),
    ).toEqual([
      ['Madrid', 1, ['Ana Ruiz'], 'map', 'Madrid HQ'],
      ['Lisbon', 2, ['Bea Sol', 'Dani Gil'], 'add', undefined],
      [OTHER_ID, 1, ['Carl Mora'], 'leave', undefined],
    ]);
    expect(dry.here.locations).toEqual([{ id: MADRID, name: 'Madrid HQ' }]);
    expect(dry.here.entities.map((e) => e.country)).toEqual(['ES']);
  });

  it('fills a new one in from the workplace’s own columns, never from a home', async () => {
    const dry = await plan(undefined, {
      headers: [...headers, 'Time Zone', 'Work Location Address', 'Home Country', 'Home City'],
      rows: [
        [
          'Ana',
          'Ruiz',
          'ana@acme.test',
          '2026-03-01',
          'Stamford',
          'America/New_York',
          '1 Main St, Stamford, CT 06901',
          'Spain',
          'Madrid',
        ],
        ['Bea', 'Sol', 'bea@acme.test', '2026-03-01', 'Pune Hub', '', '', 'Spain', 'Madrid'],
      ],
    });
    expect(dry.workplaces.map((w) => [w.value, w.proposed, w.note])).toEqual([
      [
        'Stamford',
        {
          kind: 'add',
          name: 'Stamford',
          country: 'US',
          timeZone: 'America/New_York',
          legalEntityId: ES,
        },
        null,
      ],
      [
        'Pune Hub',
        {
          kind: 'add',
          name: 'Pune Hub',
          country: 'IN',
          timeZone: 'Asia/Kolkata',
          legalEntityId: ES,
        },
        null,
      ],
    ]);
  });

  it('maps, adds and leaves empty as HR chose, and names who is left empty', async () => {
    const dry = await plan({
      madrid: { kind: 'map', locationId: MADRID },
      lisbon: { kind: 'add', name: 'Lisboa', country: 'PT', timeZone: 'Europe/Lisbon' },
      [OTHER_ID]: { kind: 'leave' },
    });
    const [ana, , carl] = dry.rows;
    expect(ana?.changes).toMatchObject({ location_id: MADRID });
    expect(dry.newLocations).toEqual([
      { name: 'Lisboa', legalEntityId: ES, country: 'PT', timeZone: 'Europe/Lisbon' },
    ]);
    expect(carl?.leftEmpty).toEqual([
      expect.objectContaining({
        key: 'location_id',
        reason: 'left empty, as chosen in the import',
      }),
    ]);
  });
});

describe('org units named in a file', () => {
  const ENG = '00000000-0000-4000-8000-0000000000a1';
  const PLAT = '00000000-0000-4000-8000-0000000000a2';
  const SALES_PLAT = '00000000-0000-4000-8000-0000000000a3';
  const DATA = '00000000-0000-4000-8000-0000000000a4';
  const SALES = '00000000-0000-4000-8000-0000000000a5';
  const rows = [
    ['Ana', 'Ruiz', 'ana@acme.test', '2026-03-01', 'Engineering › Platform'],
    ['Bea', 'Sol', 'bea@acme.test', '2026-03-01', 'engineering'],
    ['Carl', 'Mora', 'carl@acme.test', '2026-03-01', 'Platform'],
    ['Dani', 'Gil', 'dani@acme.test', '2026-03-01', 'Marketing'],
    ['Eva', 'Paz', 'eva@acme.test', '2026-03-01', 'Data'],
  ];

  it('finds a unit by its path or its own name, and leaves anything else empty for HR', async () => {
    const store = priyasTenant();
    store.versions.push(
      versionOf(2, [
        ...attributes,
        define({ key: 'team', dataType: 'org_unit_ref', typeConfig: { kind: 'org_unit_ref' } }),
      ]),
    );
    const file = await parseUpload(
      csv(['Given name', 'Family name', 'Work email', 'Hire date', 'team'], rows),
    );
    const version = store.versions.at(-1);
    if (!file.ok || !version) throw new Error('no file');
    const proposed = await proposeMapping({
      file: file.value,
      version,
      relations: HR_RELATIONS,
      advisor: null,
    });
    const mapping = resolveMapping(proposed, {}, version, HR_RELATIONS);
    if (!mapping.ok) throw new Error(mapping.error.message);
    const unit = (id: string, name: string, parentId: string | null, archived = false) =>
      [id, { id, name, parentId, archived }] as const;
    const result = await dryRun(
      tx,
      {
        calendars: fixedCalendars({
          ...UTC_CALENDAR,
          orgUnits: new Map([
            unit(ENG, 'Engineering', null),
            unit(PLAT, 'Platform', ENG),
            unit(SALES, 'Sales', null),
            unit(SALES_PLAT, 'Platform', SALES),
            unit(DATA, 'Data', ENG, true),
          ]),
        }),
        access: personAccess(store.deps),
        schemas: store.deps.schemas,
        relations: store.deps.relations,
        clock: store.deps.clock,
      },
      { ...asking, file: file.value, mapping: mapping.value },
    );
    if (!result.ok) throw new Error(result.error.message);
    const [ana, bea, carl, dani, eva] = result.value.rows;
    expect(ana?.changes).toMatchObject({ team: PLAT });
    expect(bea?.changes).toMatchObject({ team: ENG });
    for (const row of [carl, dani, eva]) expect(row?.changes).not.toHaveProperty('team');
    expect([carl, dani, eva].map((r) => r?.leftEmpty.map((l) => l.reason))).toEqual([
      ['more than one is called “Platform”'],
      ['no org unit here is called “Marketing”: add it in Settings › Organisation › Org units'],
      ['“Data” is archived'],
    ]);
  });
});
