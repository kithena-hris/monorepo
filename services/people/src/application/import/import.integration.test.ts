import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixedClock, ok } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { Person } from '../../domain/person/person.js';
import { drizzlePersonRepository } from '../../infrastructure/drizzle-person-repository.js';
import {
  drizzlePersonReader,
  drizzleRelations,
  drizzleSchemaVersions,
} from '../../infrastructure/drizzle-person-reader.js';
import { drizzleSchemaRepository } from '../../infrastructure/drizzle-schema-repository.js';
import { staticKeyRing } from '../../infrastructure/envelope.js';
import { drizzleSecretStore } from '../../infrastructure/secret-store.js';
import { drizzleUniqueClaims } from '../../infrastructure/unique.js';
import { sharing, tenantTransaction } from '../../infrastructure/unit-of-work.js';
import { define, versionOf } from '../person/in-memory.js';
import { inTenantResult, personAccess, type PersonAccessDeps } from '../person/person-access.js';
import { commitImport, commitImportRetrying, type CommitDeps, type RowScope } from './commit.js';
import { asking, attributes, csv, HEADERS, priyasRows } from './fixture.js';
import { drizzleImportLedger, drizzleRowScope } from './ledger.js';
import { proposeMapping, resolveMapping } from './mapping.js';
import { parseUpload } from './parse.js';
import { utcCalendars } from '../org/org.js';
import { drizzleIdempotency } from '../../http/idempotency.js';
import { idempotent, restHandler, type RestRequest } from '../../http/rest.js';
import { screenRoutes, type ScreenRouteDeps } from '../../http/screens.js';
import type { PeopleService } from '../person/service.js';

/**
 * PEO-041 over Postgres, as `svc_people`: the checksum constraint, the
 * savepoint per row, and the outbox — the three things memory cannot prove.
 */

const TENANT = asking.tenantId;
const HOLDER = '00000000-0000-4000-8000-0000000000d1';
const HR_RELATIONS = {
  isSelf: false,
  isManager: false,
  isInManagerChain: false,
  isHr: true,
  isFinance: false,
  isAdmin: false,
};

let stopPg: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let admin: ReturnType<typeof drizzle>;
let inTenant: ReturnType<typeof tenantTransaction>;

const ring = staticKeyRing([{ id: 'k1', key: randomBytes(32) }]);
const personDeps: PersonAccessDeps = {
  calendars: utcCalendars,
  people: drizzlePersonRepository(),
  reader: drizzlePersonReader(),
  schemas: drizzleSchemaVersions(),
  relations: drizzleRelations(),
  secrets: drizzleSecretStore(ring),
  uniques: drizzleUniqueClaims(ring),
  clock: fixedClock('2026-09-22T09:00:00.000Z'),
  newId: randomUUID,
};
const deps: CommitDeps = {
  calendars: utcCalendars,
  access: personAccess(personDeps),
  schemas: personDeps.schemas,
  relations: personDeps.relations,
  clock: personDeps.clock,
  newId: randomUUID,
  ledger: drizzleImportLedger(),
  rowScope: drizzleRowScope,
};

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../../migrations/${file}`, import.meta.url), 'utf8');

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  const adminClient = postgres(pg.url, { max: 1 });
  clients.push(adminClient);
  admin = drizzle(adminClient);
  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922160000_people_registry.sql',
    '20260922170000_people_person.sql',
    '20260924220000_people_access_end.sql',
    '20260924150000_people_unique_hash.sql',
    '20260923110000_people_completeness.sql',
    '20260923120000_people_webhooks.sql',
    '20260923130000_people_import_export.sql',
    '20260924170000_people_calendar.sql',
    '20260924170100_people_tenant_company.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  const serviceClient = postgres(asService.toString(), { max: 4 });
  clients.push(serviceClient);
  inTenant = tenantTransaction(drizzle(serviceClient));

  await inTenant(TENANT, async ({ tx }) => {
    await drizzleSchemaRepository().appendVersion(
      tx,
      TENANT,
      versionOf(1, attributes),
      [],
      '2026-09-01',
    );
    // Somebody already holding c61@acme.test, whom the dry run cannot see as
    // holding it: the write path's claim is what finds out.
    await drizzlePersonRepository().create(
      tx,
      Person.rehydrate({
        id: HOLDER,
        tenantId: TENANT,
        status: 'active',
        identityAccountId: null,
        hireDate: '2026-01-01',
        lastWorkingDay: null,
      }),
    );
    await tx.execute(sql`
      INSERT INTO people.attribute_unique (tenant_id, attribute_key, scope_id, normalised_value, person_id)
      VALUES (${TENANT}::uuid, 'work_email', ${TENANT}::uuid, 'c61@acme.test', ${HOLDER}::uuid)`);
  });
}, 180_000);

afterAll(async () => {
  for (const c of clients) await c.end();
  await stopPg?.();
});

async function upload(bytes: Uint8Array) {
  const file = await parseUpload(bytes);
  if (!file.ok) throw new Error(file.error.message);
  const version = versionOf(1, attributes);
  const proposed = await proposeMapping({
    file: file.value,
    version,
    relations: HR_RELATIONS,
    advisor: null,
  });
  const mapping = resolveMapping(proposed, {}, version, HR_RELATIONS);
  if (!mapping.ok) throw new Error(mapping.error.message);
  return inTenantResult(inTenant, TENANT, (tx) =>
    commitImport(tx, deps, { ...asking, file: file.value, mapping: mapping.value }),
  );
}

const count = async (query: ReturnType<typeof sql>) =>
  Number([...(await admin.execute<{ n: string }>(query))][0]?.n);

describe('an import over Postgres', () => {
  // The first ten new hires, and one row with no work email.
  const bytes = csv(HEADERS, [...priyasRows().slice(61, 71), priyasRows()[389 + 4] ?? []]);

  it('writes each row in its own savepoint: the one refused leaves nothing behind', async () => {
    const people = await count(sql`SELECT count(*) AS n FROM people.person`);
    const result = await upload(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== 'imported') return;
    expect(result.value.counts).toMatchObject({ created: 9, blocked: 2 });
    // Nine people, and no provisional orphan from the row whose claim failed.
    expect(await count(sql`SELECT count(*) AS n FROM people.person`)).toBe(people + 9);
    expect(new TextDecoder().decode(result.value.report)).toContain('work_email is already in use');
  });

  it('the same file twice creates one set of people, even uploaded twice at once', async () => {
    const people = await count(sql`SELECT count(*) AS n FROM people.person`);
    const again = await upload(bytes);
    expect(again.ok && again.value.status).toBe('already_imported');

    const fresh = csv(HEADERS, priyasRows().slice(100, 105));
    const racing = await Promise.all([upload(fresh), upload(fresh)]);
    expect(racing.map((r) => r.ok && r.value.status).toSorted()).toEqual([
      'already_imported',
      'imported',
    ]);

    expect(await count(sql`SELECT count(*) AS n FROM people.person`)).toBe(people + 5);
    expect(await count(sql`SELECT count(*) AS n FROM people.import`)).toBe(2);
    expect(
      await count(
        sql`SELECT count(*) AS n FROM people.outbox WHERE event_name = 'people.import.completed'`,
      ),
    ).toBe(2);
  });

  it('hires a provisional account it matches, telling identity once, and nothing on a re-import', async () => {
    // §8.2: an account provisioned before the import, holding its email and
    // the name typed at enrolment. The row confirms it, with a start date.
    const LINKED = '00000000-0000-4000-8000-0000000000d2';
    const ACCOUNT = '00000000-0000-4000-8000-0000000000b9';
    await inTenant(TENANT, async ({ tx }) => {
      await drizzlePersonRepository().create(
        tx,
        Person.rehydrate({
          id: LINKED,
          tenantId: TENANT,
          status: 'provisional',
          identityAccountId: ACCOUNT,
          hireDate: '2026-11-01',
          lastWorkingDay: null,
        }),
        { workEmail: 'linked@acme.test', givenName: 'Grace', familyName: 'Hopper' },
      );
    });
    const events = (name: string) =>
      count(
        sql`SELECT count(*) AS n FROM people.outbox WHERE event_name = ${name} AND aggregate_id = ${LINKED}`,
      );

    const file = csv(HEADERS, [
      ['Grace', 'Hopper', 'linked@acme.test', '2026-10-01', '', '', '', ''],
    ]);
    const first = await upload(file);
    expect(first.ok && first.value.status === 'imported' && first.value.counts).toMatchObject({
      updated: 1,
    });
    expect(await events('people.person.hired')).toBe(1);
    expect(await events('people.person.identity_facts_changed')).toBe(1);
    const [hired] = await admin.execute(
      sql`SELECT envelope->'payload' AS payload FROM people.outbox WHERE event_name = 'people.person.hired' AND aggregate_id = ${LINKED}`,
    );
    expect(hired?.['payload']).toMatchObject({
      identityAccountId: ACCOUNT,
      employment: { from: '2026-10-01', to: null },
      schemaVersion: 1,
      sourceOfRecord: 'own',
    });
    const [row] = await admin.execute(
      sql`SELECT status, hire_date::text AS hire_date FROM people.person WHERE id = ${LINKED}::uuid`,
    );
    expect(row).toMatchObject({ status: 'pre_hire', hire_date: '2026-10-01' });

    const again = await upload(file);
    expect(again.ok && again.value.status).toBe('already_imported');
    expect(await events('people.person.hired')).toBe(1);
    expect(await events('people.person.identity_facts_changed')).toBe(1);
  });

  it('tells identity once, with the final name, when a row renames and hires an account', async () => {
    const RENAMED = '00000000-0000-4000-8000-0000000000d3';
    const ACCOUNT = '00000000-0000-4000-8000-0000000000ba';
    await inTenant(TENANT, async ({ tx }) => {
      await drizzlePersonRepository().create(
        tx,
        Person.rehydrate({
          id: RENAMED,
          tenantId: TENANT,
          status: 'provisional',
          identityAccountId: ACCOUNT,
          hireDate: '2026-11-01',
          lastWorkingDay: null,
        }),
        { workEmail: 'renamed@acme.test', givenName: 'Kate', familyName: 'Jonson' },
      );
    });

    const result = await upload(
      csv(HEADERS, [['Katherine', 'Johnson', 'renamed@acme.test', '2026-10-01', '', '', '', '']]),
    );
    expect(result.ok && result.value.status === 'imported' && result.value.counts).toMatchObject({
      updated: 1,
    });
    const facts = [
      ...(await admin.execute(sql`
        SELECT envelope->'payload' AS payload FROM people.outbox
         WHERE event_name = 'people.person.identity_facts_changed' AND aggregate_id = ${RENAMED}`)),
    ];
    expect(facts).toHaveLength(1);
    expect(facts[0]?.['payload']).toMatchObject({
      name: { given: 'Katherine', family: 'Johnson' },
      employmentStart: '2026-10-01',
    });
  });

  it('keeps one tenant’s ledger from another', async () => {
    const other = '00000000-0000-4000-8000-00000000000b';
    const seen = await inTenant(other, ({ tx }) => tx.execute(sql`SELECT id FROM people.import`));
    expect([...seen]).toHaveLength(0);
  });
});

describe('two imports claiming the same attributes in opposite orders (PEO-106)', () => {
  // Their own tenant, with a second unique attribute: one import claims
  // work_email then employee_number, the other employee_number then
  // work_email, each holding its first claim while the other takes its own.
  const CONTENDED = '00000000-0000-4000-8000-00000000000c';
  const P1 = '00000000-0000-4000-8000-0000000000e1';
  const P2 = '00000000-0000-4000-8000-0000000000e2';
  const headers = ['Given name', 'Family name', 'Work email', 'Hire date', 'Employee number'];
  const withNumber = [
    ...attributes,
    define({
      key: 'employee_number',
      label: { default: 'Employee number' },
      uniqueScope: 'tenant',
    }),
  ];
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  // Each row holds its locks a moment before the next, so the two interleave.
  const slowRows: RowScope = async (tx, fn) => {
    const done = await drizzleRowScope(tx, fn);
    await pause(400);
    return done;
  };
  const slow: CommitDeps = { ...deps, rowScope: slowRows };

  beforeAll(async () => {
    await inTenant(CONTENDED, async ({ tx }) => {
      await drizzleSchemaRepository().appendVersion(
        tx,
        CONTENDED,
        versionOf(1, withNumber),
        [],
        '2026-09-01',
      );
      for (const [id, email] of [
        [P1, 'p1@acme.test'],
        [P2, 'p2@acme.test'],
      ] as const) {
        await drizzlePersonRepository().create(
          tx,
          Person.rehydrate({
            id,
            tenantId: CONTENDED,
            status: 'active',
            identityAccountId: null,
            hireDate: '2026-01-01',
            lastWorkingDay: null,
          }),
          { workEmail: email, givenName: 'P', familyName: id.slice(-1) },
        );
      }
    });
  });

  async function prepared(rows: string[][]) {
    const file = await parseUpload(csv(headers, rows));
    if (!file.ok) throw new Error(file.error.message);
    const version = versionOf(1, withNumber);
    const proposed = await proposeMapping({
      file: file.value,
      version,
      relations: HR_RELATIONS,
      advisor: null,
    });
    const mapping = resolveMapping(proposed, {}, version, HR_RELATIONS);
    if (!mapping.ok) throw new Error(mapping.error.message);
    return { ...asking, tenantId: CONTENDED, file: file.value, mapping: mapping.value };
  }

  async function race(round: number, attempts: number, retried: string[]) {
    // A: a new person (work_email), then P1's number. B: P2's number, then a new person.
    const a = await prepared([
      ['Ana', 'Ay', `a${String(round)}@acme.test`, '2026-03-01', ''],
      ['', '', 'p1@acme.test', '', `A-${String(round)}`],
    ]);
    const b = await prepared([
      ['', '', 'p2@acme.test', '', `B-${String(round)}`],
      ['Bo', 'Bee', `b${String(round)}@acme.test`, '2026-03-01', ''],
    ]);
    const options = {
      attempts,
      backoffMs: 50,
      onRetry: (_attempt: number, code: string) => {
        retried.push(code);
      },
    };
    const first = commitImportRetrying(inTenant, slow, a, options);
    await pause(150);
    const second = commitImportRetrying(inTenant, slow, b, options);
    return Promise.all([first, second]);
  }

  it('deadlocks without a retry, and says so rather than throwing', async () => {
    const retried: string[] = [];
    const results = await race(1, 1, retried);
    const lost = results.flatMap((r) => (r.ok ? [] : [r.error.code]));
    expect(lost).toEqual(['IMPORT_CONTENDED']);
  });

  it('both commit when the loser is retried, each once', async () => {
    const retried: string[] = [];
    const results = await race(2, 3, retried);
    expect(retried).toEqual(['40P01']);
    expect(results.map((r) => r.ok && r.value.status)).toEqual(['imported', 'imported']);
    expect(results.map((r) => r.ok && r.value.status === 'imported' && r.value.counts)).toEqual([
      expect.objectContaining({ created: 1, updated: 1, blocked: 0 }),
      expect.objectContaining({ created: 1, updated: 1, blocked: 0 }),
    ]);
    const numbers = [
      ...(await admin.execute(sql`
        SELECT count(*) AS n FROM people.import WHERE tenant_id = ${CONTENDED}::uuid`)),
    ];
    // Round 1's winner, and both of round 2: one ledger row each, nothing twice.
    expect(Number(numbers[0]?.['n'])).toBe(3);
  });

  /*
   * PEO-116: the same race through the keyed path. The use case's own
   * transactions join the key's as savepoints (`sharing`), so a deadlock
   * rolls back one attempt's savepoint, the retry runs in a fresh one, and
   * the Idempotency-Key row, written after in the outer transaction, commits
   * with whichever attempt won, or not at all.
   */
  describe('keyed, through the route (PEO-116)', () => {
    const deadlocks: string[] = [];
    /** `slowRows`, noting each real deadlock that passes through a row. */
    const observed: RowScope = async (tx, fn) => {
      try {
        return await slowRows(tx, fn);
      } catch (error) {
        for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
          if ((e as { code?: unknown }).code === '40P01') {
            deadlocks.push('40P01');
            break;
          }
        }
        throw error;
      }
    };
    const idempotency = drizzleIdempotency();
    const service = (): PeopleService =>
      ({
        access: deps.access,
        schemas: deps.schemas,
        // Late: `inTenant` is set in beforeAll, after this describe is built.
        inTenant: (tenantId: string, fn: Parameters<typeof inTenant>[1]) => inTenant(tenantId, fn),
      }) as unknown as PeopleService;
    const who = { ...asking, tenantId: CONTENDED };
    const rest = restHandler({
      service: service(),
      callerFrom: () => Promise.resolve(ok(who)),
      idempotency,
      screens: screenRoutes(
        {
          service: service(),
          relations: personDeps.relations,
          clock: personDeps.clock,
          calendars: utcCalendars,
          personOf: () => Promise.resolve(null),
          advisor: null,
          commit: {
            ledger: drizzleImportLedger(),
            rowScope: observed,
            newId: randomUUID,
            calendars: utcCalendars,
          },
        } as unknown as ScreenRouteDeps,
        idempotency,
      ),
    });

    const rowsA = (round: number) => [
      ['Ana', 'Ay', `a${String(round)}@acme.test`, '2026-03-01', ''],
      ['', '', 'p1@acme.test', '', `A-${String(round)}`],
    ];
    const rowsB = (round: number) => [
      ['', '', 'p2@acme.test', '', `B-${String(round)}`],
      ['Bo', 'Bee', `b${String(round)}@acme.test`, '2026-03-01', ''],
    ];
    const commit = (key: string, rows: string[][]): RestRequest => ({
      method: 'POST',
      url: '/v1/imports',
      headers: { 'idempotency-key': key },
      body: JSON.stringify({
        name: 'people.csv',
        file: Buffer.from(csv(headers, rows)).toString('base64'),
      }),
    });

    const tally = async () => ({
      people: await count(
        sql`SELECT count(*) AS n FROM people.person WHERE tenant_id = ${CONTENDED}::uuid`,
      ),
      claims: await count(
        sql`SELECT count(*) AS n FROM people.attribute_unique WHERE tenant_id = ${CONTENDED}::uuid`,
      ),
      numbers: await count(sql`
        SELECT count(*) AS n FROM people.person_attribute_history
         WHERE tenant_id = ${CONTENDED}::uuid AND attribute_key = 'employee_number'`),
      imports: await count(
        sql`SELECT count(*) AS n FROM people.import WHERE tenant_id = ${CONTENDED}::uuid`,
      ),
    });
    const keyRows = (key: string) =>
      count(sql`SELECT count(*) AS n FROM people.idempotency_key
                 WHERE tenant_id = ${CONTENDED}::uuid AND key = ${key}`);

    it('deadlocks for real, retries in a savepoint, and commits each key with its import', async () => {
      deadlocks.length = 0;
      const before = await tally();
      const first = rest(commit('race-3-a', rowsA(3)));
      await pause(150);
      const second = rest(commit('race-3-b', rowsB(3)));
      const answers = await Promise.all([first, second]);

      // Not a pass by luck: Postgres chose a victim at least once.
      expect(deadlocks.length).toBeGreaterThan(0);
      for (const r of answers) {
        if (r?.status !== 201) {
          expect(r?.body).toMatchObject({ error: { code: 'IMPORT_CONTENDED' } });
        }
      }
      // Both went through: the victim's attempt rolled back to its savepoint,
      // the outer transaction survived the 40P01, and the retry committed
      // with its key. Were the savepoint not there, the key's insert would
      // meet an aborted transaction and the request would fail.
      const won = answers.filter((r) => r?.status === 201).length;
      expect(won).toBe(2);

      // Each key exists exactly when its import went through.
      expect(await keyRows('race-3-a')).toBe(answers[0]?.status === 201 ? 1 : 0);
      expect(await keyRows('race-3-b')).toBe(answers[1]?.status === 201 ? 1 : 0);

      // Nothing half-written: per import that won, one new person, one new
      // claim (the email; the number's claim moves off the person's last
      // one), one number in history and one ledger row.
      const after = await tally();
      expect(after.people - before.people).toBe(won);
      expect(after.claims - before.claims).toBe(won);
      expect(after.numbers - before.numbers).toBe(won);
      expect(after.imports - before.imports).toBe(won);

      // A retry of a key that won is answered and imports nothing again.
      const again = await rest(commit('race-3-a', rowsA(3)));
      if (answers[0]?.status === 201) {
        expect(again?.body).toMatchObject({ error: { code: 'ALREADY_IMPORTED' } });
      }
      expect(await tally()).toEqual(after);
    });

    it('leaves no key and no rows for the request that loses outright', async () => {
      deadlocks.length = 0;
      const before = await tally();
      const observedDeps: CommitDeps = { ...deps, rowScope: observed };
      // The route's own composition, with one attempt so that the loser loses.
      const keyedCommit = async (key: string, rows: string[][]) => {
        const input = await prepared(rows);
        return idempotent(
          { service: service(), idempotency },
          who,
          commit(key, rows),
          201,
          async (tx) => {
            const done = await sharing({ tx, tenantId: CONTENDED }, () =>
              commitImportRetrying(inTenant, observedDeps, input, { attempts: 1 }),
            );
            return done.ok ? ok(CONTENDED) : done;
          },
          () => Promise.resolve({ status: 201, body: { ok: true } }),
        );
      };
      const first = keyedCommit('race-4-a', rowsA(4));
      await pause(150);
      const second = keyedCommit('race-4-b', rowsB(4));
      const answers = await Promise.all([first, second]);

      expect(deadlocks.length).toBeGreaterThan(0);
      const codes = answers.map((r) =>
        r.status < 300 ? 'ok' : (r.body as { error: { code: string } }).error.code,
      );
      expect(codes.toSorted()).toEqual(['IMPORT_CONTENDED', 'ok']);
      const lost = codes[0] === 'ok' ? 'race-4-b' : 'race-4-a';
      const kept = lost === 'race-4-a' ? 'race-4-b' : 'race-4-a';
      expect(await keyRows(lost)).toBe(0);
      expect(await keyRows(kept)).toBe(1);

      const after = await tally();
      expect(after.people - before.people).toBe(1);
      expect(after.claims - before.claims).toBe(1);
      expect(after.numbers - before.numbers).toBe(1);
      expect(after.imports - before.imports).toBe(1);
      const loserEmail = lost === 'race-4-a' ? 'a4@acme.test' : 'b4@acme.test';
      expect(
        await count(sql`SELECT count(*) AS n FROM people.person
                         WHERE tenant_id = ${CONTENDED}::uuid AND work_email = ${loserEmail}`),
      ).toBe(0);
    });
  });
});
