import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { err, failure, fixedClock } from '@kithena/domain-kit';

import { noTransaction as tx } from '../person/in-memory.js';
import { commitImport, forgetImportReports, reportKey, type CommitDeps } from './commit.js';
import {
  asking,
  commitDeps,
  csv,
  HEADERS,
  inMemoryLedger,
  priyasRows,
  priyasTenant,
  reportStore,
} from './fixture.js';
import { proposeMapping, resolveMapping } from './mapping.js';
import { parseUpload } from './parse.js';

/** The lookalike Priya's file names as a duplicate, and somebody it updates. */
const TWIN_26 = '00000000-0000-4000-8000-000000000926';
const EXISTING_1 = '00000000-0000-4000-8000-000000000901';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const HR_RELATIONS = {
  isSelf: false,
  isManager: false,
  isInManagerChain: false,
  isHr: true,
  isFinance: false,
  isAdmin: false,
};

async function upload(deps: CommitDeps, bytes: Uint8Array) {
  const file = await parseUpload(bytes);
  if (!file.ok) throw new Error(file.error.message);
  const version = await deps.schemas.current(tx, asking.tenantId);
  if (!version) throw new Error('no version');
  const proposed = await proposeMapping({
    file: file.value,
    version,
    relations: HR_RELATIONS,
    advisor: null,
  });
  const mapping = resolveMapping(proposed, {}, version, HR_RELATIONS);
  if (!mapping.ok) throw new Error(mapping.error.message);
  const result = await commitImport(tx, deps, {
    ...asking,
    file: file.value,
    mapping: mapping.value,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('committing Priya’s file', () => {
  it('writes the good rows, reports the rest, and carries no value on its events', async () => {
    const store = priyasTenant();
    const ledger = inMemoryLedger();
    const result = await upload(commitDeps(store, ledger), csv(HEADERS, priyasRows()));

    expect(result.status).toBe('imported');
    if (result.status !== 'imported') return;
    expect(result.counts).toEqual({
      created: 368,
      updated: 21,
      unchanged: 4,
      blocked: 14,
      duplicate: 5,
      incomplete: 88,
    });
    expect(store.rows.size).toBe(27 + 368);

    // Hired through the lifecycle, not by writing a column.
    const hired = [...store.rows.values()].find((r) => r.fields.workEmail === 'c7@acme.test');
    expect(hired?.snapshot).toMatchObject({ status: 'active', hireDate: '2026-03-01' });

    expect(ledger.events.map((e) => e.eventName)).toEqual([
      'people.import.started',
      'people.import.completed',
    ]);
    const audit = JSON.stringify(ledger.events);
    expect(audit).not.toMatch(/@acme\.test|CC-2|New\d/u);
    const started = ledger.events[0]?.payload as {
      rowCount: number;
      attributeKeys: string[];
      checksum: string;
    };
    expect(started.rowCount).toBe(412);
    expect(started.checksum).toBe(sha256(csv(HEADERS, priyasRows())));
    expect(started.attributeKeys).toEqual(expect.arrayContaining(['work_email', 'hire_date']));
  });

  it('twice creates one set of people, and the second upload is handed the first report', async () => {
    const store = priyasTenant();
    const reports = reportStore(store.deps.clock);
    const ledger = inMemoryLedger();
    const deps = commitDeps(store, ledger, reports);
    const bytes = csv(HEADERS, priyasRows());
    const first = await upload(deps, bytes);
    if (first.status !== 'imported') throw new Error('not imported');
    const people = store.rows.size;
    const events = store.events.length;

    const second = await upload(deps, bytes);
    expect(second).toMatchObject({ status: 'already_imported', importId: first.importId });
    expect(store.rows.size).toBe(people);
    expect(store.events.length).toBe(events);

    // The report is kept, sealed: the bytes at rest are not the CSV, and the
    // link the re-upload was given opens to exactly the first report.
    const key = reportKey(asking.tenantId, sha256(bytes));
    const atRest = new TextDecoder().decode(reports.store.raw(key));
    expect(atRest).not.toContain('NoEmail0');
    const opened = await reports.store.open(second.reportUrl ?? '');
    expect(opened.ok && opened.value.bytes).toEqual(first.report);
    expect(new TextDecoder().decode(first.report)).toContain('NoEmail0');

    // Beside it, who it contains, by id only: the two lookalikes it names.
    expect(await reports.index.containing(tx, asking.tenantId, TWIN_26)).toEqual([sha256(bytes)]);

    // A week on, the sweep deletes it and a re-upload is told it has expired.
    const later = '2026-09-29T09:00:01.000Z';
    const third = await upload({ ...deps, clock: fixedClock(later) }, bytes);
    expect(third).toEqual({ status: 'already_imported', importId: first.importId, reportUrl: null });
    expect(await reports.store.purge(later, 10)).toBe(1);
    expect(reports.store.raw(key)).toBeUndefined();
  });

  it('is deleted, with its index row, when somebody it contains is erased', async () => {
    const store = priyasTenant();
    const reports = reportStore(store.deps.clock);
    const deps = commitDeps(store, inMemoryLedger(), reports);
    const bytes = csv(HEADERS, priyasRows());
    await upload(deps, bytes);
    const key = reportKey(asking.tenantId, sha256(bytes));

    // Somebody not in it: nothing goes.
    expect(await forgetImportReports(tx, reports, asking.tenantId, EXISTING_1)).toBe(0);
    expect(reports.store.raw(key)).toBeDefined();

    expect(await forgetImportReports(tx, reports, asking.tenantId, TWIN_26)).toBe(1);
    expect(reports.store.raw(key)).toBeUndefined();
    expect(reports.index.rows.size).toBe(0);
    const again = await upload(deps, bytes);
    expect(again).toMatchObject({ status: 'already_imported', reportUrl: null });
  });
});

describe('the blocked-row report', () => {
  it('re-imports cleanly after a fix', async () => {
    const store = priyasTenant();
    const deps = commitDeps(store);
    const first = await upload(deps, csv(HEADERS, priyasRows()));
    if (first.status !== 'imported') throw new Error('not imported');

    const report = await parseUpload(first.report);
    if (!report.ok) throw new Error(report.error.message);
    expect(report.value.headers).toEqual([...HEADERS, '__source_row', '__reason']);
    expect(report.value.rows).toHaveLength(14 + 5);
    expect(report.value.rows[0]?.cells.at(-1)).toMatch(
      /Work email: a new person needs work_email/u,
    );

    // Fix the blocked rows in "Excel": an email where missing, a real hire date.
    const email = HEADERS.indexOf('Work email');
    const hired = HEADERS.indexOf('Hire date');
    const fixed = report.value.rows
      .filter(
        (r) =>
          (r.cells.at(-1) ?? '').startsWith('Work email') ||
          (r.cells.at(-1) ?? '').startsWith('Hire date'),
      )
      .map((r, i) =>
        r.cells.map((c, col) =>
          col === email && c === ''
            ? `fixed${String(i)}@acme.test`
            : col === hired
              ? '2026-03-02'
              : c,
        ),
      );
    const again = await upload(deps, csv(report.value.headers, fixed));
    expect(again.status === 'imported' && again.counts).toMatchObject({ created: 14, blocked: 0 });
    expect(again.status === 'imported' && again.ignoredColumns).toEqual([
      '__source_row',
      '__reason',
    ]);
  });

  it('neutralises a cell a spreadsheet would run as a formula', async () => {
    const store = priyasTenant();
    const row = HEADERS.map((h) =>
      h === 'Given name' ? '=HYPERLINK("https://evil.test","x")' : h === 'Family name' ? 'X' : '',
    );
    const result = await upload(commitDeps(store), csv(HEADERS, [row]));
    if (result.status !== 'imported') throw new Error('not imported');
    const text = new TextDecoder().decode(result.report);
    expect(text).toContain(`"'=HYPERLINK(""https://evil.test"",""x"")"`);
  });
});

describe('a row the write path refuses', () => {
  it('is blocked alone and the rest proceed', async () => {
    const store = priyasTenant();
    const uniques = { ...store.deps.uniques };
    store.deps.uniques.claim = (t, tenant, c) =>
      c.value === 'c1@acme.test'
        ? Promise.resolve(
            err(failure('UNIQUE_VALUE_TAKEN', 'work_email is already in use', ['work_email'])),
          )
        : uniques.claim(t, tenant, c);
    const rows = priyasRows().slice(0, 3);
    const result = await upload(commitDeps(store), csv(HEADERS, rows));
    expect(result.status === 'imported' && result.counts).toMatchObject({ created: 2, blocked: 1 });
  });
});
