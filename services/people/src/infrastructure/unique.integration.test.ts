import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { startPostgres } from '@kithena/testing';

import { staticKeyRing, type MasterKey } from './envelope.js';
import {
  claimHash,
  claimRotation,
  drizzleUniqueClaims,
  normalise,
  rolloutSkipped,
  type UniqueClaims,
} from './unique.js';
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
 * The SELECT exists for the error message and for looking under every key
 * mid-rotation. The unique index is what is true.
 *
 * And since PEO-082, what the table holds: a keyed hash, never the value.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';
const MADRID = '00000000-0000-4000-8000-0000000000e1';
const BERLIN = '00000000-0000-4000-8000-0000000000e2';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const GRACE = '00000000-0000-4000-8000-0000000000a2';
const LIN = '00000000-0000-4000-8000-0000000000a3';

let stopPg: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let inTenant: ReturnType<typeof tenantTransaction>;

const K1: MasterKey = { id: 'k1', key: randomBytes(32) };
const K2: MasterKey = { id: 'k2', key: randomBytes(32) };
const claims = drizzleUniqueClaims(staticKeyRing([K1]));

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
    '20260924220000_people_access_end.sql',
    '20260924150000_people_unique_hash.sql',
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
    [LIN, ACME],
  ] as const) {
    await admin.execute(sql`
      INSERT INTO people.person (id, tenant_id, status, given_name, family_name)
      VALUES (${id}::uuid, ${tenant}::uuid, 'active', 'Ada', 'Lovelace')
    `);
  }
});

const claim = (
  personId: string,
  value: string,
  scopeId = ACME,
  attributeKey = 'employee_number',
  using: UniqueClaims = claims,
) => inTenant(ACME, ({ tx }) => using.claim(tx, ACME, { attributeKey, scopeId, value, personId }));

/** Every value in every table in the `people` schema, as one string, as the retention test dumps it. */
async function everythingStored(): Promise<string> {
  const tables = await admin.execute(sql`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'people' AND table_type = 'BASE TABLE'
  `);
  const dumps: string[] = [];
  for (const table of tables) {
    // eslint-disable-next-line no-await-in-loop -- a handful of tables, in a test
    const rows = await admin.execute(sql.raw(`SELECT * FROM people.${String(table['table_name'])}`));
    dumps.push(JSON.stringify([...rows]));
  }
  return dumps.join('\n');
}

const keyIds = async (): Promise<(string | null)[]> =>
  [...(await admin.execute(sql`SELECT key_id FROM people.attribute_unique ORDER BY person_id`))].map(
    (r) => r['key_id'] as string | null,
  );

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
      SELECT encode(value_hash, 'base64') AS h FROM people.attribute_unique WHERE person_id = ${ADA}::uuid
    `);
    expect([...rows].map((r) => String(r['h']))).toEqual([
      claimHash(K1, ACME, { attributeKey: 'employee_number', scopeId: ACME }, 'e-2'),
    ]);
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
      SELECT person_id FROM people.attribute_unique WHERE attribute_key = 'employee_number'
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
      SELECT count(*)::int AS n FROM people.attribute_unique WHERE attribute_key = 'employee_number'
    `);
    expect(Number([...rows][0]?.['n'])).toBe(1);
  });
});

describe('what a claim stores', () => {
  it('is a keyed hash: no value, in any spelling, anywhere in the schema', async () => {
    await claim(ADA, 'Emp-4711');
    await claim(GRACE, '12345678Z', ACME, 'es_nif');

    const everything = (await everythingStored()).toLowerCase();
    for (const plain of ['emp-4711', '12345678z', '12345678']) {
      expect(everything).not.toContain(plain);
    }

    const rows = await admin.execute(sql`
      SELECT normalised_value, octet_length(value_hash) AS n, key_id FROM people.attribute_unique
    `);
    expect([...rows].map((r) => ({ ...r }))).toEqual([
      { normalised_value: null, n: 32, key_id: 'k1' },
      { normalised_value: null, n: 32, key_id: 'k1' },
    ]);
  });

  it('is keyed per tenant, so one value in two tenants hashes apart', () => {
    const rule = { attributeKey: 'employee_number', scopeId: ACME };
    expect(claimHash(K1, ACME, rule, 'e-1')).not.toBe(claimHash(K1, GLOBEX, rule, 'e-1'));
    expect(claimHash(K1, ACME, rule, 'e-1')).not.toBe(claimHash(K2, ACME, rule, 'e-1'));
    expect(claimHash(K1, ACME, rule, 'e-1')).toBe(claimHash(K1, ACME, rule, 'e-1'));
  });

  it('refuses the plaintext and the hash side by side', async () => {
    await expect(
      admin.execute(sql`
        INSERT INTO people.attribute_unique (tenant_id, attribute_key, scope_id, normalised_value, value_hash, key_id, person_id)
        VALUES (${ACME}::uuid, 'employee_number', ${ACME}::uuid, 'e-1', decode(repeat('00', 32), 'hex'), 'k1', ${ADA}::uuid)
      `),
    ).rejects.toThrow();
  });
});

describe('rotating the key', () => {
  const values = new Map<string, string>([
    [ADA, 'E-1'],
    [GRACE, 'E-2'],
  ]);
  const valueOf = (personId: string) => Promise.resolve(values.get(personId) ?? null);
  const rotating = drizzleUniqueClaims(staticKeyRing([K2, K1]));
  const rotate = (limit?: number) =>
    inTenant(ACME, async ({ tx }) => (await rotating.rotate(tx, ACME, valueOf, limit === undefined ? {} : { limit })).seen);

  beforeEach(async () => {
    await claim(ADA, 'E-1');
    await claim(GRACE, 'E-2');
  });

  it('refuses a duplicate before, during and after, and ends with every claim re-keyed', async () => {
    // Before: nothing rotated, the new ring still finds the old hash.
    expect((await claim(LIN, ' e-1', ACME, 'employee_number', rotating)).ok).toBe(false);

    // During: one re-keyed, one not, and both still found.
    expect(await rotate(1)).toBe(1);
    expect(await keyIds()).toEqual(['k2', 'k1']);
    expect((await claim(LIN, 'E-1', ACME, 'employee_number', rotating)).ok).toBe(false);
    expect((await claim(LIN, 'E-2', ACME, 'employee_number', rotating)).ok).toBe(false);

    // After: all under k2, and a deployment that has dropped k1 still refuses.
    expect(await rotate()).toBe(1);
    expect(await keyIds()).toEqual(['k2', 'k2']);
    const k2Only = drizzleUniqueClaims(staticKeyRing([K2]));
    expect((await claim(LIN, 'E-1', ACME, 'employee_number', k2Only)).ok).toBe(false);
    expect((await claim(LIN, 'E-2', ACME, 'employee_number', k2Only)).ok).toBe(false);
    expect((await claim(LIN, 'E-3', ACME, 'employee_number', k2Only)).ok).toBe(true);
  });

  it('is idempotent: a second pass touches nothing', async () => {
    await rotate();
    expect(await rotate()).toBe(0);
    expect(await keyIds()).toEqual(['k2', 'k2']);
  });

  it('releases a claim whose value is gone', async () => {
    values.delete(GRACE);
    try {
      await rotate();
    } finally {
      values.set(GRACE, 'E-2');
    }
    const rows = await admin.execute(sql`SELECT person_id FROM people.attribute_unique`);
    expect([...rows].map((r) => r['person_id'])).toEqual([ADA]);
  });

  it('lets exactly one of two writers win when their current keys differ', async () => {
    // Mid-rollout: one replica still writes under k1 (holding k2 to read
    // with, which is the rollout's first step), the next under k2. Hashes
    // differ, so the index alone would let both in; the lock does not.
    const staged = drizzleUniqueClaims(staticKeyRing([K1, K2]));
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // The first holds its transaction open after claiming, so the second
    // asks while the first's row is uncommitted and under the other key.
    let commitFirst = (): void => undefined;
    const open = new Promise<void>((resolve) => {
      commitFirst = resolve;
    });
    const first = inTenant(ACME, async ({ tx }) => {
      const result = await staged.claim(tx, ACME, {
        attributeKey: 'employee_number',
        scopeId: ACME,
        value: 'E-9',
        personId: LIN,
      });
      await open;
      return result;
    });
    await pause(200);
    const second = claim(GRACE, 'E-9', ACME, 'employee_number', rotating);
    await pause(200);
    commitFirst();

    const results = await Promise.all([first, second]);
    expect(results.map((r) => r.ok)).toEqual([true, false]);
  });

  it('backfills a claim written before PEO-082, refusing its duplicate throughout', async () => {
    await admin.execute(sql`
      INSERT INTO people.attribute_unique (tenant_id, attribute_key, scope_id, normalised_value, person_id)
      VALUES (${ACME}::uuid, 'works_council_id', ${ACME}::uuid, 'wc-9', ${LIN}::uuid)
    `);
    values.set(LIN, 'WC-9');
    try {
      expect((await claim(ADA, ' WC-9 ', ACME, 'works_council_id', rotating)).ok).toBe(false);
      await rotate();
    } finally {
      values.delete(LIN);
    }

    const rows = await admin.execute(sql`
      SELECT normalised_value, key_id FROM people.attribute_unique WHERE person_id = ${LIN}::uuid
    `);
    expect([...rows].map((r) => ({ ...r }))).toEqual([{ normalised_value: null, key_id: 'k2' }]);
    expect((await claim(ADA, 'WC-9', ACME, 'works_council_id', rotating)).ok).toBe(false);
    expect(await everythingStored()).not.toContain('wc-9');
  });
});

describe('two writers claiming the same two rules in opposite orders', () => {
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const a = { attributeKey: 'employee_number', scopeId: ACME };
  const b = { attributeKey: 'works_council_id', scopeId: ACME };
  /** Claim `first`, hold the transaction open a moment, then claim `second`. */
  const write = (personId: string, first: typeof a, second: typeof a, lockFirst: boolean) =>
    inTenant(ACME, async ({ tx }) => {
      if (lockFirst) await claims.lock(tx, ACME, [first, second]);
      const one = await claims.claim(tx, ACME, { ...first, value: `${personId}-1`, personId });
      await pause(300);
      const two = await claims.claim(tx, ACME, { ...second, value: `${personId}-2`, personId });
      return one.ok && two.ok;
    });
  // The second starts while the first sits between its two claims.
  const race = async (lockFirst: boolean) => {
    const first = write(ADA, a, b, lockFirst);
    await pause(100);
    const second = write(GRACE, b, a, lockFirst);
    return Promise.allSettled([first, second]);
  };

  it('deadlock when each rule is locked only as it is claimed', async () => {
    const results = await race(false);
    // Postgres breaks the cycle by failing one of them: 40P01.
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('both complete when every rule is locked first, in one order', async () => {
    const results = await race(true);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : 'threw'))).toEqual([true, true]);
  });
});

describe('a duplicate the rotation finds', () => {
  // Ada's claim is under k1; Grace took the same value under k2 from a ring
  // that never held k1 — a duplicate that predates the rotation.
  const values = new Map([[ADA, 'E-1']]);
  const valueOf = (personId: string) => Promise.resolve(values.get(personId) ?? null);
  const rotating = drizzleUniqueClaims(staticKeyRing([K2, K1]));
  const rotate = () =>
    inTenant(ACME, async ({ tx }) => rotating.rotate(tx, ACME, valueOf, { limit: 1 }));

  beforeEach(async () => {
    await claim(ADA, 'E-1');
    await claim(GRACE, 'E-1', ACME, 'employee_number', drizzleUniqueClaims(staticKeyRing([K2])));
  });

  it('is skipped, left under the old key, reported once, and never fails the batch', async () => {
    const first = await rotate();
    expect(first.conflicts).toEqual([
      { attributeKey: 'employee_number', heldBy: GRACE, staleClaimBy: ADA },
    ]);

    const rows = await admin.execute(sql`
      SELECT person_id, key_id, conflict_with FROM people.attribute_unique ORDER BY person_id
    `);
    expect([...rows].map((r) => ({ ...r }))).toEqual([
      { person_id: ADA, key_id: 'k1', conflict_with: GRACE },
      { person_id: GRACE, key_id: 'k2', conflict_with: null },
    ]);
    // Still unique under k1: a third person is refused.
    expect((await claim(LIN, 'E-1', ACME, 'employee_number', rotating)).ok).toBe(false);

    // The next run says nothing more, and the cursor walks past it.
    expect((await rotate()).conflicts).toEqual([]);
  });

  it('is re-keyed, and the mark cleared, once the other holder changes', async () => {
    await rotate();
    await claim(GRACE, 'E-7', ACME, 'employee_number', rotating);
    expect((await rotate()).conflicts).toEqual([]);
    expect(await keyIds()).toEqual(['k2', 'k2']);
    const marks = await admin.execute(sql`
      SELECT count(*)::int AS n FROM people.attribute_unique WHERE conflict_with IS NOT NULL
    `);
    expect(Number([...marks][0]?.['n'])).toBe(0);
  });
});

describe('a key rollout that skipped its first step', () => {
  const env = (...keys: MasterKey[]) => keys.map((k) => `${k.id}:${k.key.toString('base64')}`).join(',');

  it('is recognised: claims under a key the ring lacks, none under the current one', async () => {
    await claim(ADA, 'E-1');
    const skipped = (keys: MasterKey[]) =>
      inTenant(ACME, ({ tx }) => rolloutSkipped(tx, ACME, staticKeyRing(keys)));
    expect(await skipped([K2])).toEqual(['k1']);
    expect(await skipped([K2, K1])).toBeNull();
    expect(await skipped([K1])).toBeNull();
  });

  it('stops the rotation job, and leaves the claims as they were', async () => {
    await claim(ADA, 'E-1');
    await claimRotation(inTenant, env(K2))(ACME);
    expect(await keyIds()).toEqual(['k1']);
  });
});
