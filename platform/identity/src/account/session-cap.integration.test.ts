import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { fixedClock } from '@kithena/domain-kit';
import { startPostgres } from '@kithena/testing';

import { startSession } from './application/start-session.js';
import { drizzleAccountRepository } from './infrastructure/drizzle-account-repository.js';
import type { EventContext } from './domain/account.js';

/**
 * The session cap, under a race, against a real database.
 *
 * This is the test the slot design exists for. Allocating a slot is
 * read-then-write: the domain looks at the sessions it loaded and picks one, so
 * two logins a millisecond apart both read three sessions, both pick slot four,
 * and both try to insert it. Nothing in the application layer can prevent that
 * — only `UNIQUE (account_id, slot)` can, and a mock will happily agree that it
 * would have.
 *
 * `docs/build-plan.md` says not to skip this one. It is why.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const OTHER_TENANT = '00000000-0000-4000-8000-00000000000b';
const IDENTITY = '00000000-0000-4000-8000-00000000000d';
const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ACCOUNT = '00000000-0000-4000-8000-0000000000a2';

let stop: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let admin: PostgresJsDatabase;
let db: PostgresJsDatabase;

beforeAll(async () => {
  const started = await startPostgres();
  stop = started.stop;

  adminClient = postgres(started.url, { max: 1 });
  admin = drizzle(adminClient);

  // The real migrations, not a hand-rolled approximation. A schema retyped for
  // a test is a schema that can disagree with production, and the disagreement
  // is always in the constraint somebody forgot to copy.
  for (const file of ['20260821120000_tenant_registry.sql', '20260821230000_identity.sql']) {
    const path = new URL(`../../../../migrations/${file}`, import.meta.url);
    await admin.execute(sql.raw(await readFile(path, 'utf8')));
  }

  await admin.execute(sql`
    INSERT INTO platform.tenant (id, slug, display_name, status) VALUES
      (${TENANT}::uuid,       'acme',   'Acme',   'active'),
      (${OTHER_TENANT}::uuid, 'globex', 'Globex', 'active')
  `);
  await admin.execute(sql`INSERT INTO platform.identity (id) VALUES (${IDENTITY}::uuid)`);
  await admin.execute(sql`
    INSERT INTO platform.account
      (id, tenant_id, identity_id, status, work_email, time_zone, employment_start, session_limit)
    VALUES
      (${ACCOUNT}::uuid, ${TENANT}::uuid, ${IDENTITY}::uuid, 'active',
       'ada@acme.example', 'Europe/Madrid', '2026-01-01', 4),
      (${OTHER_ACCOUNT}::uuid, ${OTHER_TENANT}::uuid, ${IDENTITY}::uuid, 'active',
       'ada@globex.example', 'Europe/Madrid', '2026-01-01', 4)
  `);

  /*
   * The assertions run as a non-superuser. A superuser bypasses row-level
   * security unconditionally — neither FORCE nor NOBYPASSRLS applies to it —
   * and Testcontainers hands back a superuser, so a test using that connection
   * would report perfect isolation while enforcing none.
   */
  await admin.execute(sql`CREATE ROLE svc_test LOGIN PASSWORD 'svc_test' NOBYPASSRLS`);
  await admin.execute(sql`GRANT USAGE ON SCHEMA platform TO svc_test`);
  await admin.execute(
    sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO svc_test`,
  );

  const asService = new URL(started.url);
  asService.username = 'svc_test';
  asService.password = 'svc_test';
  // A real pool, because the race below needs genuinely simultaneous
  // connections. `max: 1` would serialise the very thing under test and the
  // suite would pass without ever contending for a slot.
  serviceClient = postgres(asService.toString(), { max: 12 });
  db = drizzle(serviceClient);
});

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stop?.();
});

function context(seed: string): EventContext {
  let n = 0;
  return {
    clock: fixedClock('2026-04-01T09:00:00.000Z'),
    newEventId: () => {
      n += 1;
      // The final group is twelve hex characters. Padding to eight produced a
      // string that looked like a uuid and was rejected by the column.
      return `01890000-0000-7000-8000-${seed}${String(n).padStart(8, '0')}`;
    },
    actor: { kind: 'system', process: 'integration-test' },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
    causationId: null,
  };
}

const device = { ip: '203.0.113.7', userAgent: 'integration', aaguid: null };

/** What the route produces when the caller supplies nothing. */
const unknownDevice = { ip: null, userAgent: null, aaguid: null };

/** The real thing: a tenant-scoped transaction, exactly as the service runs it. */
function inTenantTransaction<T>(tenantId: string, fn: (tx: PostgresJsDatabase) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

const run = startSession({
  accounts: drizzleAccountRepository(),
  inTenantTransaction,
});

async function sessionCount(accountId: string, tenantId = TENANT): Promise<number> {
  return inTenantTransaction(tenantId, async (tx) => {
    const rows = await tx.execute(
      sql`SELECT count(*)::int AS n FROM platform.session WHERE account_id = ${accountId}::uuid`,
    );
    return Number([...rows][0]?.['n'] ?? 0);
  });
}

async function clearSessions(): Promise<void> {
  await admin.execute(sql`DELETE FROM platform.session`);
}

describe('the fifth device cannot exist', () => {
  it('holds when twelve logins arrive at once', async () => {
    await clearSessions();

    // Twelve simultaneous logins on an empty account. Every one of them reads
    // the same empty session list and every one of them picks slot 1.
    const attempts = Array.from({ length: 12 }, (_, i) =>
      run(
        TENANT,
        ACCOUNT,
        {
          id: `00000000-0000-4000-8000-00000000b${String(i).padStart(3, '0')}`,
          device,
          amr: ['swk'],
        },
        context(String(i).padStart(4, '0')),
      ),
    );

    const results = await Promise.allSettled(attempts);

    // Every one either succeeds or fails cleanly. None may crash the process,
    // and none may leave a partial row behind.
    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.ok);
    expect(succeeded.length).toBeGreaterThan(0);

    expect(await sessionCount(ACCOUNT)).toBe(4);
  });

  it('still holds when the account starts full', async () => {
    await clearSessions();

    // Fill it first, one at a time.
    for (let i = 0; i < 4; i += 1) {
      await run(
        TENANT,
        ACCOUNT,
        {
          id: `00000000-0000-4000-8000-00000000c${String(i).padStart(3, '0')}`,
          device,
          amr: ['swk'],
        },
        context(`1${String(i).padStart(3, '0')}`),
      );
    }
    expect(await sessionCount(ACCOUNT)).toBe(4);

    // Now eight more at once, every one of which must evict to get in.
    await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        run(
          TENANT,
          ACCOUNT,
          {
            id: `00000000-0000-4000-8000-00000000d${String(i).padStart(3, '0')}`,
            device,
            amr: ['swk'],
          },
          context(`2${String(i).padStart(3, '0')}`),
        ),
      ),
    );

    expect(await sessionCount(ACCOUNT)).toBe(4);
  });

  it('refuses a fifth row even when the domain is bypassed entirely', async () => {
    // The negative control, and the point of having the index at all. If the
    // application layer were wrong — or replaced, or bypassed by a script — the
    // database still refuses. Without this assertion the two tests above only
    // prove the domain agrees with itself.
    await clearSessions();
    for (let slot = 1; slot <= 4; slot += 1) {
      await admin.execute(sql`
        INSERT INTO platform.session (id, tenant_id, account_id, slot, expires_at)
        VALUES (gen_random_uuid(), ${TENANT}::uuid, ${ACCOUNT}::uuid, ${slot}, now() + interval '1 day')
      `);
    }

    await expect(
      admin.execute(sql`
        INSERT INTO platform.session (id, tenant_id, account_id, slot, expires_at)
        VALUES (gen_random_uuid(), ${TENANT}::uuid, ${ACCOUNT}::uuid, 3, now() + interval '1 day')
      `),
    ).rejects.toThrow();

    expect(await sessionCount(ACCOUNT)).toBe(4);
  });
});

describe('a session whose origin is not known', () => {
  it('is written without an address rather than with a placeholder', async () => {
    /*
     * The `ip` column is `inet`, and `inet` refuses anything that is not an
     * address. `Device.ip` used to be a plain `string` with `'unknown'`
     * standing in for absence, which is harmless against the `text` column
     * beside it and fatal here: Postgres raised `22P02` and a sign-in that
     * should have refused politely became a 500 with a stack trace.
     *
     * The type now says `string | null`, so the placeholder cannot be
     * constructed. This asserts the database agrees.
     */
    await clearSessions();

    const result = await run(
      TENANT,
      ACCOUNT,
      { id: '00000000-0000-4000-8000-0000000000ff', device: unknownDevice, amr: ['swk'] },
      context('8000'),
    );

    expect(result.ok).toBe(true);
    expect(await sessionCount(ACCOUNT)).toBe(1);

    const rows = await inTenantTransaction(TENANT, (tx) =>
      tx.execute(
        sql`SELECT ip, user_agent FROM platform.session WHERE account_id = ${ACCOUNT}::uuid`,
      ),
    );
    const row = [...rows][0];
    expect(row?.['ip']).toBeNull();
    expect(row?.['user_agent']).toBeNull();
  });

  it('still stores a real address when there is one', async () => {
    await clearSessions();

    await run(
      TENANT,
      ACCOUNT,
      { id: '00000000-0000-4000-8000-0000000000fe', device, amr: ['swk'] },
      context('8100'),
    );

    const rows = await inTenantTransaction(TENANT, (tx) =>
      tx.execute(
        sql`SELECT host(ip) AS ip FROM platform.session WHERE account_id = ${ACCOUNT}::uuid`,
      ),
    );
    expect([...rows][0]?.['ip']).toBe('203.0.113.7');
  });
});

describe('the cap is per account, not per person', () => {
  it('gives the same human four devices at each employer', async () => {
    // One identity, two accounts, two tenants. A contractor at two customers
    // does not get four devices in total — they get four at each, because the
    // cap belongs to the employment relationship rather than to the human.
    await clearSessions();

    for (let i = 0; i < 4; i += 1) {
      await run(
        TENANT,
        ACCOUNT,
        {
          id: `00000000-0000-4000-8000-00000000e${String(i).padStart(3, '0')}`,
          device,
          amr: ['swk'],
        },
        context(`3${String(i).padStart(3, '0')}`),
      );
      await run(
        OTHER_TENANT,
        OTHER_ACCOUNT,
        {
          id: `00000000-0000-4000-8000-00000000f${String(i).padStart(3, '0')}`,
          device,
          amr: ['swk'],
        },
        context(`4${String(i).padStart(3, '0')}`),
      );
    }

    expect(await sessionCount(ACCOUNT)).toBe(4);
    expect(await sessionCount(OTHER_ACCOUNT, OTHER_TENANT)).toBe(4);
  });
});

describe('row-level security isolates the tables identity owns', () => {
  it('hides another tenant’s account', async () => {
    const seen = await inTenantTransaction(TENANT, async (tx) => {
      const rows = await tx.execute(sql`SELECT id FROM platform.account`);
      return [...rows].map((r) => String(r['id']));
    });
    expect(seen).toEqual([ACCOUNT]);
  });

  it('hides everything when no tenant is set', async () => {
    // The failure mode: a query that runs outside a tenant scope and quietly
    // returns every customer's accounts.
    const rows = await db.execute(sql`SELECT id FROM platform.account`);
    expect([...rows]).toHaveLength(0);
  });

  it('returns no rows rather than raising after a scope has been used and left', async () => {
    // Pins the empty-string behaviour the NULLIF in every policy is written
    // around: `set_config(..., true)` returns to '' and not to unset, and
    // ''::uuid raises 22P02. An unscoped query must be quietly empty, not a 500.
    await inTenantTransaction(TENANT, async (tx) => tx.execute(sql`SELECT 1`));
    await expect(db.execute(sql`SELECT id FROM platform.session`)).resolves.toHaveLength(0);
  });

  it('refuses to write a session into another tenant', async () => {
    // WITH CHECK, not just USING. Without it a tenant can insert a row it will
    // then be unable to see.
    await expect(
      inTenantTransaction(TENANT, async (tx) =>
        tx.execute(sql`
          INSERT INTO platform.session (id, tenant_id, account_id, slot, expires_at)
          VALUES (gen_random_uuid(), ${OTHER_TENANT}::uuid, ${ACCOUNT}::uuid, 9, now() + interval '1 day')
        `),
      ),
    ).rejects.toThrow();
  });
});

describe('the write and its event commit together', () => {
  it('writes the outbox row in the same transaction as the session', async () => {
    await clearSessions();
    await admin.execute(sql`DELETE FROM platform.outbox`);

    await run(
      TENANT,
      ACCOUNT,
      { id: '00000000-0000-4000-8000-0000000000fa', device, amr: ['swk'] },
      context('9000'),
    );

    const events = await inTenantTransaction(TENANT, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT event_name FROM platform.outbox ORDER BY created_at`,
      );
      return [...rows].map((r) => String(r['event_name']));
    });

    expect(events).toEqual(['identity.session.started']);
  });
});
