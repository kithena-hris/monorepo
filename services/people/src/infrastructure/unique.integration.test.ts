import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { startPostgres } from '@kithena/testing';

import { drizzleUniqueClaims, normalise } from './unique.js';
import { tenantTransaction } from './unit-of-work.js';

/**
 * Uniqueness on a tenant-defined attribute.
 *
 * The test the ticket names is the last one in this file: **simultaneous
 * writes of the same employee number, and exactly one wins.** Everything
 * before it is the ordinary path, and the ordinary path is not where this
 * breaks. It breaks when two people in HR paste from the same spreadsheet at
 * the same moment, and a check-then-insert lets both through.
 *
 * The SELECT exists for the error message. The unique index is what is true.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const MADRID = '00000000-0000-4000-8000-0000000000e1';
const BERLIN = '00000000-0000-4000-8000-0000000000e2';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const GRACE = '00000000-0000-4000-8000-0000000000a2';

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;

const claims = drizzleUniqueClaims();

const migration = (file: string): Promise<string> =>
  readFile(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8');

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;

  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);

  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    '20260922160000_people_registry.sql',
    '20260922170000_people_person.sql',
  ]) {
    await admin.execute(sql.raw(await migration(file)));
  }

  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);

  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  // Several connections, because the race this file exists for cannot happen
  // on one.
  serviceClient = postgres(asService.toString(), { max: 8 });
  inTenant = tenantTransaction(drizzle(serviceClient));
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stopPg?.();
});

beforeEach(async () => {
  await admin.execute(sql`DELETE FROM people.attribute_unique`);
  await admin.execute(sql`DELETE FROM people.person`);
  for (const [id, tenant] of [
    [ADA, ACME],
    [GRACE, ACME],
  ] as const) {
    await admin.execute(sql`
      INSERT INTO people.person (id, tenant_id, status, given_name, family_name)
      VALUES (${id}::uuid, ${tenant}::uuid, 'active', 'Ada', 'Lovelace')
    `);
  }
});

const claim = (personId: string, value: string, scopeId = ACME, attributeKey = 'employee_number') =>
  inTenant(ACME, ({ tx }) => claims.claim(tx, ACME, { attributeKey, scopeId, value, personId }));

describe('normalising a value', () => {
  it('ignores surrounding space and case', () => {
    // Two employee numbers differing by a trailing space are one collision,
    // not two records.
    expect(normalise('  E-1 ')).toBe(normalise('e-1'));
  });

  it('treats the two spellings of an accented name as one', () => {
    // `José` typed on a Mac and `José` pasted from a Windows export are
    // different byte sequences, and a unique index compares bytes.
    expect(normalise('José')).toBe(normalise('José'));
  });

  it('leaves a value that differs in more than punctuation alone', () => {
    expect(normalise('E-1')).not.toBe(normalise('E-2'));
  });
});

describe('claiming a value', () => {
  it('succeeds when nobody holds it', async () => {
    expect((await claim(ADA, 'E-1')).ok).toBe(true);
  });

  it('refuses a second person, and names the first', async () => {
    // "That is taken" is not an answer HR can act on. "Ada holds it" is.
    await claim(ADA, 'E-1');
    const second = await claim(GRACE, 'E-1');

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('UNIQUE_VALUE_TAKEN');
    expect(second.error.conflict?.heldBy).toBe(ADA);
  });

  it('refuses a value that differs only in case or spacing', async () => {
    await claim(ADA, 'E-1');
    expect((await claim(GRACE, ' e-1 ')).ok).toBe(false);
  });

  it('refuses a blank value rather than claiming nothing', async () => {
    const blank = await claim(ADA, '   ');
    expect(blank.ok).toBe(false);
    if (blank.ok) return;
    expect(blank.error.code).toBe('UNIQUE_VALUE_EMPTY');
  });

  it('lets the same person change their own value', async () => {
    // The old claim is released first. Without that, somebody's second value
    // collides with their own first.
    await claim(ADA, 'E-1');
    expect((await claim(ADA, 'E-2')).ok).toBe(true);

    const rows = await admin.execute(sql`
      SELECT normalised_value FROM people.attribute_unique WHERE person_id = ${ADA}::uuid
    `);
    expect([...rows].map((r) => String(r['normalised_value']))).toEqual(['e-2']);
  });

  it('frees the old value for somebody else once it is changed', async () => {
    await claim(ADA, 'E-1');
    await claim(ADA, 'E-2');
    expect((await claim(GRACE, 'E-1')).ok).toBe(true);
  });

  it('is scoped, so two legal entities may both use a number', async () => {
    await claim(ADA, 'E-1', MADRID);
    expect((await claim(GRACE, 'E-1', BERLIN)).ok).toBe(true);
  });

  it('is per attribute, so one value does not block another field', async () => {
    await claim(ADA, 'E-1', ACME, 'employee_number');
    expect((await claim(GRACE, 'E-1', ACME, 'works_council_id')).ok).toBe(true);
  });
});

describe('releasing a claim', () => {
  it('frees the value', async () => {
    await claim(ADA, 'E-1');
    await inTenant(ACME, ({ tx }) =>
      claims.release(tx, ACME, { personId: ADA, attributeKey: 'employee_number' }),
    );
    expect((await claim(GRACE, 'E-1')).ok).toBe(true);
  });

  it('touches only the attribute it names', async () => {
    await claim(ADA, 'E-1', ACME, 'employee_number');
    await claim(ADA, 'WC-9', ACME, 'works_council_id');

    await inTenant(ACME, ({ tx }) =>
      claims.release(tx, ACME, { personId: ADA, attributeKey: 'employee_number' }),
    );

    const rows = await admin.execute(sql`
      SELECT attribute_key FROM people.attribute_unique WHERE person_id = ${ADA}::uuid
    `);
    expect([...rows].map((r) => String(r['attribute_key']))).toEqual(['works_council_id']);
  });
});

describe('another tenant', () => {
  it('may hold the same value without conflicting', async () => {
    await claim(ADA, 'E-1');

    await admin.execute(sql`
      INSERT INTO people.person (id, tenant_id, status) VALUES
        ('00000000-0000-4000-8000-0000000000b9'::uuid, ${GLOBEX}::uuid, 'active')
    `);

    const theirs = await inTenant(GLOBEX, ({ tx }) =>
      claims.claim(tx, GLOBEX, {
        attributeKey: 'employee_number',
        scopeId: GLOBEX,
        value: 'E-1',
        personId: '00000000-0000-4000-8000-0000000000b9',
      }),
    );
    expect(theirs.ok).toBe(true);
  });
});

describe('two writers at once', () => {
  it('lets exactly one win', async () => {
    /*
     * The test this ticket is written around.
     *
     * Both transactions read before either wrote, so both saw the value free.
     * The unique index is what decides between them — not the SELECT, which
     * both passed. One commits, the other gets a 23505 and reports the same
     * refusal a tidy sequential conflict would have produced.
     *
     * `max: 8` on the pool above is load bearing: on one connection these
     * would serialise and the test would prove nothing.
     */
    const results = await Promise.allSettled([claim(ADA, 'E-1'), claim(GRACE, 'E-1')]);

    const verdicts = results.map((r) =>
      r.status === 'fulfilled' ? (r.value.ok ? 'won' : 'refused') : 'threw',
    );

    expect(verdicts.filter((v) => v === 'won')).toHaveLength(1);
    expect(verdicts.filter((v) => v === 'refused')).toHaveLength(1);

    // And exactly one row, held by whichever of them got there first.
    const rows = await admin.execute(sql`
      SELECT person_id FROM people.attribute_unique WHERE normalised_value = 'e-1'
    `);
    expect([...rows]).toHaveLength(1);
  });

  it('lets exactly one win out of eight', async () => {
    // Eight people, one number, one winner. The failure this catches is a
    // retry loop that quietly lets a second writer through on the second
    // attempt.
    await admin.execute(sql`DELETE FROM people.person`);
    const ids = Array.from(
      { length: 8 },
      (_, i) => `00000000-0000-4000-8000-00000000009${String(i)}`,
    );
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop -- seeding, in a test
      await admin.execute(sql`
        INSERT INTO people.person (id, tenant_id, status) VALUES (${id}::uuid, ${ACME}::uuid, 'active')
      `);
    }

    const results = await Promise.allSettled(ids.map((id) => claim(id, 'E-7')));
    const won = results.filter((r) => r.status === 'fulfilled' && r.value.ok);

    expect(won).toHaveLength(1);

    const rows = await admin.execute(sql`
      SELECT count(*)::int AS n FROM people.attribute_unique WHERE normalised_value = 'e-7'
    `);
    expect(Number([...rows][0]?.['n'])).toBe(1);
  });
});
