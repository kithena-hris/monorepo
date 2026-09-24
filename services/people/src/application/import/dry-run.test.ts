import { describe, expect, it } from 'vitest';

import { noTransaction as tx } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import { dryRun, type ClassifiedRow } from './dry-run.js';
import { asking, csv, HEADERS, HR, priyasRows, priyasTenant } from './fixture.js';
import { proposeMapping, resolveMapping } from './mapping.js';
import { parseUpload } from './parse.js';
import { utcCalendars } from '../org/org.js';

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
