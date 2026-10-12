import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readdir, readFile } from 'node:fs/promises';
import { fixedClock } from '@kithena/domain-kit';
import type { DocumentId, DocumentTypeKey, PersonId, TenantId } from '@kithena/contracts';
import { startPostgres } from '@kithena/testing';

import { deleteDocument, share, upload } from '../application/documents.js';
import { askForDocument, placeHold, seedTypes } from '../application/organise.js';
import type { Caller, Deps } from '../application/ports.js';
import { documentScreen, library, personFile } from '../application/screens.js';
import { memoryBlobs } from './blobs.js';
import { drizzleUnitOfWork, tenantsWithDocuments } from './unit-of-work.js';

/**
 * Documents' storage (DOC-016), against every Documents migration and
 * nothing else, as `svc_documents`: the same flows the standalone suite runs
 * in memory, over Postgres, and a connection with no tenant sees nothing.
 */

const TENANT = '00000000-0000-4000-8000-0000000000ac' as TenantId;
const OTHER = '00000000-0000-4000-8000-0000000000bc' as TenantId;
const ADAM = {
  account: '7ac0e000-0000-4000-8000-0000000000a1',
  person: '00000000-0000-4000-8000-0000000000ad' as PersonId,
};
const MARCO = {
  account: '7ac0e000-0000-4000-8000-0000000000a2',
  person: '00000000-0000-4000-8000-0000000000aa' as PersonId,
};
const ADA = {
  account: '7ac0e000-0000-4000-8000-0000000000a3',
  person: '00000000-0000-4000-8000-0000000000a3' as PersonId,
};
const MIGRATIONS = new URL('../../../../migrations/', import.meta.url);

let stopPg: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let asDocuments: PostgresJsDatabase;
let deps: Deps;
let n = 0;

const caller = (who: typeof ADAM, tenantId = TENANT): Caller => ({
  tenantId,
  accountId: who.account,
  personId: who.person,
  correlationId: '00000000-0000-4000-8000-000000000001',
});
const file = (name: string) => ({
  name,
  mediaType: 'image/png',
  bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]),
});

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  const admin = postgres(pg.url, { max: 1, onnotice: () => {} });
  clients.push(admin);
  const files = (await readdir(MIGRATIONS)).filter((f) => f.includes('_documents_')).toSorted();
  for (const f of files) {
    // oxlint-disable-next-line no-await-in-loop -- in order, each builds on the last
    await admin.unsafe(await readFile(new URL(f, MIGRATIONS), 'utf8'));
  }
  await admin.unsafe(`ALTER ROLE svc_documents LOGIN PASSWORD 'svc_documents'`);
  const url = new URL(pg.url);
  url.username = 'svc_documents';
  url.password = 'svc_documents';
  const service = postgres(url.toString(), { max: 4 });
  clients.push(service);
  asDocuments = drizzle(service);
  deps = {
    uow: drizzleUnitOfWork(asDocuments),
    blobs: memoryBlobs(),
    clock: fixedClock('2026-10-12T09:00:00.000Z'),
    newId: () => `01890000-0000-7000-8000-${String(++n).padStart(12, '0')}`,
  };
  await deps.uow.run(TENANT, async (tx) => {
    for (const [who, name, team] of [
      [ADAM, 'Adam Novak', 'platform'],
      [MARCO, 'Marco Ruiz', 'platform'],
      [ADA, 'Ada Lovelace', null],
    ] as const) {
      await tx.members.upsert(
        {
          personId: who.person,
          accountId: who.account,
          displayName: name,
          workEmail: null,
          managerPersonId: null,
          teamKey: team,
          teamName: null,
          locationKey: null,
          hireDate: '2024-09-02' as never,
          terminationDate: null,
          status: 'active',
        },
        deps.newId(),
        '2026-01-01' as never,
      );
    }
    await tx.hr.add(ADA.account);
  });
  await seedTypes(deps, TENANT);
}, 180_000);

afterAll(async () => {
  for (const c of clients) await c.end({ timeout: 5 });
  await stopPg?.();
});

describe('the member projection', () => {
  it('ignores an older event and a redelivered one', async () => {
    await deps.uow.run(TENANT, async (tx) => {
      const adam = await tx.members.get(ADAM.person);
      if (adam === null) throw new Error('no Adam');
      expect(
        await tx.members.upsert(
          { ...adam, displayName: 'Old' },
          '01890000-0000-7000-8000-000000000001',
          '2020-01-01' as never,
        ),
      ).toBe(false);
      expect((await tx.members.byAccount(ADAM.account))?.displayName).toBe('Adam Novak');
    });
  });
});

describe('documents in Postgres', () => {
  let mine: DocumentId;
  let contract: DocumentId;

  it('files, shares and lists only what each person may open', async () => {
    const a = await upload(deps, caller(ADAM), {
      title: 'Mortgage pre-approval',
      typeKey: null,
      subjectPersonId: null,
      sectionId: null,
      expiresOn: null,
      requestId: null,
      file: file('m.png'),
    });
    if (!a.ok) throw new Error(a.error.message);
    mine = a.value.id;
    const c = await upload(deps, caller(ADA), {
      title: 'Employment contract',
      typeKey: 'employment_contract' as DocumentTypeKey,
      subjectPersonId: ADAM.person,
      sectionId: null,
      expiresOn: null,
      requestId: null,
      file: file('c.png'),
    });
    if (!c.ok) throw new Error(c.error.message);
    contract = c.value.id;

    const marcoBefore = await library(deps, caller(MARCO), {
      show: 'all',
      q: '',
      queue: null,
      deleted: false,
    });
    expect(marcoBefore.ok && marcoBefore.value.rows).toEqual([]);
    await share(deps, caller(ADAM), mine, [
      { grantee: { kind: 'team', teamKey: 'platform' }, permission: 'view', endsOn: null },
    ]);
    const marcoAfter = await library(deps, caller(MARCO), {
      show: 'all',
      q: '',
      queue: null,
      deleted: false,
    });
    expect(marcoAfter.ok && marcoAfter.value.rows.map((r) => r.id)).toEqual([mine]);
    const adaLib = await library(deps, caller(ADA), {
      show: 'all',
      q: '',
      queue: null,
      deleted: false,
    });
    expect(adaLib.ok && adaLib.value.rows.map((r) => r.id)).toEqual([contract]);
    const doc = await documentScreen(deps, caller(ADAM), contract);
    expect(doc.ok && doc.value.document?.row.confidential).toBe(true);
  });

  it('a request and a person’s file read back', async () => {
    const asked = await askForDocument(deps, caller(ADA), {
      personId: ADAM.person,
      typeKey: 'nda' as DocumentTypeKey,
      dueOn: null,
      message: 'Please',
    });
    expect(asked.ok).toBe(true);
    const f = await personFile(deps, caller(ADA), ADAM.person);
    expect(f.ok && f.value.rows.map((r) => r.id)).toEqual([contract]);
  });

  it('a hold keeps a document; the trash takes the rest', async () => {
    const hold = await placeHold(deps, caller(ADA), { name: 'Case 0412', documentIds: [contract] });
    expect(hold.ok).toBe(true);
    expect(await deleteDocument(deps, caller(ADA), contract)).toMatchObject({
      ok: false,
      error: { code: 'LEGAL_HOLD' },
    });
    expect((await deleteDocument(deps, caller(ADAM), mine)).ok).toBe(true);
    const deleted = await library(deps, caller(ADAM), {
      show: 'all',
      q: '',
      queue: null,
      deleted: true,
    });
    expect(deleted.ok && deleted.value.rows.map((r) => r.id)).toEqual([mine]);
  });

  it('another company sees none of it', async () => {
    const other = await library(deps, caller(ADAM, OTHER), {
      show: 'all',
      q: '',
      queue: null,
      deleted: false,
    });
    expect(other.ok && other.value.total).toBe(0);
    expect(await tenantsWithDocuments(asDocuments)).toEqual([TENANT]);
  });

  it('a connection with no tenant sees no row', async () => {
    for (const table of ['document', 'version', 'grant', 'member', 'document_type', 'outbox']) {
      // oxlint-disable-next-line no-await-in-loop -- one table at a time
      const rows = await asDocuments.execute(
        sql.raw(`SELECT count(*)::int AS n FROM documents.${table}`),
      );
      expect([...rows][0], table).toEqual({ n: 0 });
    }
  });
});
