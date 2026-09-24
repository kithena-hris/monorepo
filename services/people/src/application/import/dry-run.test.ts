import { describe, expect, it } from 'vitest';

import { noTransaction as tx } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import { cellFindings, dryRun, type ClassifiedRow } from './dry-run.js';
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
      create: 368,
      update: 21,
      unchanged: 4,
      blocked: 14,
      duplicate: 5,
    });
    expect(dry.blockedBy).toEqual({ 'missing work_email': 11, 'invalid hire_date': 3 });
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

  it('missing core identity blocks the row, naming the column', async () => {
    const { result } = await run(csv(HEADERS, [row({ ...good, 'Family name': '' })]));
    const only = result.ok ? result.value.rows[0] : undefined;
    expect(only?.outcome).toBe('blocked');
    expect(only?.problems).toEqual([
      expect.objectContaining({ kind: 'missing', key: 'family_name', column: 'Family name' }),
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

  it('an invalid value blocks the row and names the cell', async () => {
    const { result } = await run(
      csv(HEADERS, [
        row(good),
        row({ ...good, 'Work email': 'b@acme.test', 'Date of birth': '2090-01-01' }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows.map((r: ClassifiedRow) => r.outcome)).toEqual(['create', 'blocked']);
    expect(result.value.rows[1]).toMatchObject({
      row: 3,
      problems: [
        expect.objectContaining({ kind: 'invalid', column: 'Date of birth', key: 'date_of_birth' }),
      ],
    });
  });

  it('never drops an existing person’s new hire date: with no hire date field to correct, the row blocks', async () => {
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
    expect(only?.outcome).toBe('blocked');
    expect(only?.problems).toEqual([
      expect.objectContaining({ kind: 'invalid', key: 'hire_date', column: 'Hire date' }),
    ]);
  });

  it('refuses an ambiguous date unless told the file’s order', async () => {
    const { result } = await run(csv(HEADERS, [row({ ...good, 'Hire date': '03/04/2026' })]));
    expect(result.ok && result.value.rows[0]?.outcome).toBe('blocked');
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

  it('still blocks the row when there is more than one to choose from', async () => {
    const only = await withEntities([ES, PT]);
    expect(only?.outcome).toBe('blocked');
    expect(only?.problems).toEqual([
      expect.objectContaining({ kind: 'missing', key: 'legal_entity_id' }),
    ]);
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
