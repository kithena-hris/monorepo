import { readdir, readFile } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { startPostgres } from '@kithena/testing';

import { drizzleExportLedger } from '../application/export/ledger.js';
import { drizzleImportLedger, drizzleReportIndex } from '../application/import/ledger.js';
import { drizzleTransfers } from './drizzle-transfers.js';
import { tenantTransaction } from './unit-of-work.js';

/**
 * The shared history against Postgres: both ledgers written the way the
 * import and the export write them, read back together newest first, a page
 * at a time, and never across tenants.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const ADA = '00000000-0000-4000-8000-0000000000b1';
const IMPORT = '00000000-0000-4000-9000-000000000001';
const QUEUED = '00000000-0000-4000-9000-000000000002';
const DONE = '00000000-0000-4000-9000-000000000003';
const CHECKSUM = 'c'.repeat(64);
const migrations = new URL('../../../../migrations/', import.meta.url);

let stop: (() => Promise<void>) | undefined;
let admin: PostgresJsDatabase;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let inTenant: ReturnType<typeof tenantTransaction>;

beforeAll(async () => {
  const pg = await startPostgres();
  stop = pg.stop;
  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);
  const files = (await readdir(migrations))
    .filter((f) => f === '20260821120000_tenant_registry.sql' || /^\d{14}_people_/.test(f))
    .toSorted();
  for (const file of files) {
    await admin.execute(sql.raw(await readFile(new URL(file, migrations), 'utf8')));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const url = new URL(pg.url);
  url.username = 'svc_people';
  url.password = 'svc_people';
  serviceClient = postgres(url.toString(), { max: 2 });
  inTenant = tenantTransaction(drizzle(serviceClient));

  const imports = drizzleImportLedger();
  const exports = drizzleExportLedger();
  await inTenant(ACME, async ({ tx }) => {
    await imports.claim(tx, {
      tenantId: ACME,
      importId: IMPORT,
      checksum: CHECKSUM,
      actorId: ADA,
      rowCount: 14,
      name: 'new-joiners-sep.csv',
    });
    await imports.complete(tx, ACME, IMPORT, {
      created: 12,
      updated: 0,
      unchanged: 0,
      blocked: 1,
      duplicate: 1,
      incomplete: 0,
    });
    await drizzleReportIndex().save(tx, {
      tenantId: ACME,
      checksum: CHECKSUM,
      personIds: [],
      storedAt: '2026-09-21T14:02:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    await exports.queue(tx, { tenantId: ACME, exportId: QUEUED, requestedBy: ADA });
    await exports.queue(tx, { tenantId: ACME, exportId: DONE, requestedBy: ADA });
    await exports.complete(tx, {
      tenantId: ACME,
      exportId: DONE,
      requestedBy: ADA,
      rowCount: 124,
      fileNames: ['people-2026-09-22.xlsx'],
      expiresAt: '2026-09-23T09:00:00.000Z',
      format: 'xlsx',
      reason: 'Quarterly headcount for Finance',
      attributeKeys: ['given_name', 'job_title'],
    });
  });
  // Deterministic order: the import first, then the two exports.
  await admin.execute(sql`UPDATE people.import SET started_at = '2026-09-21T14:02:00Z'`);
  await admin.execute(sql`
    UPDATE people.export
       SET requested_at = CASE id WHEN ${QUEUED}::uuid THEN '2026-09-22T08:00:00Z'::timestamptz
                                  ELSE '2026-09-22T08:10:00Z'::timestamptz END`);
}, 180_000);

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stop?.();
});

describe('the transfer history', () => {
  it('reads both ledgers together, newest first, with what each wrote', async () => {
    const rows = await inTenant(ACME, ({ tx }) =>
      drizzleTransfers().page(tx, ACME, { before: null, limit: 10 }),
    );
    expect(rows.map((r) => [r.kind, r.id])).toEqual([
      ['export', DONE],
      ['export', QUEUED],
      ['import', IMPORT],
    ]);
    expect(rows[0]).toMatchObject({
      actor: ADA,
      rowCount: 124,
      format: 'xlsx',
      reason: 'Quarterly headcount for Finance',
      fileNames: ['people-2026-09-22.xlsx'],
      expiresAt: '2026-09-23T09:00:00.000Z',
      checksum: null,
    });
    // Still being prepared: nothing to say about it but who and when.
    expect(rows[1]).toMatchObject({ rowCount: null, format: null, fileNames: null });
    expect(rows[2]).toMatchObject({
      name: 'new-joiners-sep.csv',
      counts: { created: 12, blocked: 1, duplicate: 1 },
      checksum: CHECKSUM,
      reportExpiresAt: '2099-01-01T00:00:00.000Z',
    });
  });

  it('pages from the last row it gave', async () => {
    const page = (before: string | null) =>
      inTenant(ACME, ({ tx }) => drizzleTransfers().page(tx, ACME, { before, limit: 2 }));
    const first = await page(null);
    expect(first.map((r) => r.id)).toEqual([DONE, QUEUED]);
    const second = await page(QUEUED);
    expect(second.map((r) => r.id)).toEqual([IMPORT]);
  });

  it('keeps the export’s field keys, and shows another tenant nothing', async () => {
    const [kept] = await admin.execute<{ attribute_keys: string[] }>(
      sql`SELECT attribute_keys FROM people.export WHERE id = ${DONE}::uuid`,
    );
    expect(kept?.attribute_keys).toEqual(['given_name', 'job_title']);
    const theirs = await inTenant(GLOBEX, ({ tx }) =>
      drizzleTransfers().page(tx, ACME, { before: null, limit: 10 }),
    );
    expect(theirs).toEqual([]);
  });

  it('refuses a name no upload could have, or a format nobody exports', async () => {
    await expect(
      admin.execute(sql`UPDATE people.import SET name = '' WHERE id = ${IMPORT}::uuid`),
    ).rejects.toMatchObject({ cause: { constraint_name: 'import_name_bounded' } });
    await expect(
      admin.execute(sql`UPDATE people.export SET format = 'docx' WHERE id = ${DONE}::uuid`),
    ).rejects.toMatchObject({ cause: { constraint_name: 'export_format_known' } });
  });
});
