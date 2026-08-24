import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { startPostgres } from '@kithena/testing';

import { drizzleDeliveryLog } from './infrastructure/drizzle-delivery-log.js';
import type { EmailAddress } from './domain/address.js';

/**
 * The delivery log, against a real Postgres.
 *
 * A container rather than a fake, because the two properties worth having here
 * are both the database's rather than the code's.
 *
 * The first is isolation. `messaging.delivery` carries row-level security with
 * FORCE, and `svc_messaging` does not bypass it — so the question "can one
 * customer's support query read another's" is answered by a policy, and a fake
 * repository would answer it by agreeing with whatever the code did. The
 * identity service's integration tests make the same argument.
 *
 * The second is the webhook lookup. A provider event names a message and no
 * tenant, so finding the row has to cross every tenant, which is exactly what
 * the policy forbids — `messaging.delivery_tenant_of` is SECURITY DEFINER for
 * that reason, and whether a SECURITY DEFINER function actually sees what it is
 * supposed to is not something a unit test can tell you.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GLOBEX = '00000000-0000-4000-8000-00000000000b';

const address = (value: string) => value as EmailAddress;

/**
 * What Postgres actually said, past the driver's wrapper.
 *
 * Drizzle rethrows with its own message — `Failed query: insert into …` — and
 * hangs the driver's error off `cause`, so a regex over `error.message` never
 * sees the constraint. Asserting the SQLSTATE and the constraint name is both
 * what the first version of this file got wrong and the better assertion: a
 * message is prose that can be reworded, and `23514` on
 * `delivery_status_known` is the specific refusal being claimed.
 */
async function refusal(run: () => Promise<unknown>): Promise<{
  code: string;
  constraint: string;
}> {
  try {
    await run();
  } catch (error: unknown) {
    const cause: unknown = error instanceof Error && 'cause' in error ? error.cause : error;
    const read = (key: string): string => {
      const value: unknown =
        cause === null || typeof cause !== 'object' ? undefined : Reflect.get(cause, key);
      return typeof value === 'string' ? value : '';
    };
    return { code: read('code'), constraint: read('constraint_name') };
  }
  throw new Error('expected the database to refuse this, and it did not');
}

let stop: (() => Promise<void>) | undefined;
let adminClient: Sql | undefined;
let serviceClient: Sql | undefined;
let admin: PostgresJsDatabase;
let db: PostgresJsDatabase;

beforeAll(async () => {
  const pg = await startPostgres();
  stop = pg.stop;

  adminClient = postgres(pg.url, { max: 1 });
  admin = drizzle(adminClient);

  // The role first: the migration grants to it, and a GRANT to a role that does
  // not exist is an error rather than a no-op.
  await admin.execute(sql`CREATE ROLE svc_messaging LOGIN PASSWORD 'svc_messaging' NOBYPASSRLS`);

  for (const file of [
    // For `platform.touch_updated_at`, which the delivery trigger uses. Kept as
    // a real dependency rather than stubbed: if that function moves, this test
    // should be the thing that notices.
    '20260821120000_tenant_registry.sql',
    '20260824090000_messaging.sql',
  ]) {
    const path = new URL(`../../../../migrations/${file}`, import.meta.url);
    await admin.execute(sql.raw(await readFile(path, 'utf8')));
  }

  const asService = new URL(pg.url);
  asService.username = 'svc_messaging';
  asService.password = 'svc_messaging';
  serviceClient = postgres(asService.toString(), { max: 4 });
  db = drizzle(serviceClient);
}, 180_000);

afterAll(async () => {
  await adminClient?.end();
  await serviceClient?.end();
  await stop?.();
});

function log() {
  const inTenantTransaction = <T>(
    tenantId: string,
    fn: (tx: PostgresJsDatabase) => Promise<T>,
  ): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
      return fn(tx);
    });

  return drizzleDeliveryLog(inTenantTransaction, async (provider, messageId) => {
    const rows = await db.execute(
      sql`SELECT messaging.delivery_tenant_of(${provider}, ${messageId}) AS tenant_id`,
    );
    const value = [...rows][0]?.['tenant_id'];
    return typeof value === 'string' ? value : null;
  });
}

const invitation = (over: { tenantId?: string; to?: string; messageId?: string | null } = {}) => ({
  tenantId: over.tenantId ?? ACME,
  kind: 'account_invitation' as const,
  to: address(over.to ?? 'ada@acme.example'),
  provider: 'resend',
  providerMessageId: over.messageId === undefined ? `msg_${String(Math.random())}` : over.messageId,
  status: 'accepted' as const,
  reason: null,
});

describe('recording an attempt', () => {
  it('writes a row the service can read back within its own tenant', async () => {
    const id = await log().record(invitation());
    expect(id).not.toBeNull();

    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${ACME}, true)`);
      return [...(await tx.execute(sql`SELECT to_email, status FROM messaging.delivery`))];
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.['status']).toBe('accepted');
  });

  it('refuses a status the schema does not know', async () => {
    // The check constraint, not the type. This service is one of the ways rows
    // get here and a constraint is the only thing every write passes through.
    const refused = await refusal(() =>
      log().record({ ...invitation(), status: 'posted' as never }),
    );
    expect(refused.code).toBe('23514');
    expect(refused.constraint).toBe('delivery_status_known');
  });

  it('refuses a kind the schema does not know', async () => {
    const refused = await refusal(() =>
      log().record({ ...invitation(), kind: 'newsletter' as never }),
    );
    expect(refused.code).toBe('23514');
    expect(refused.constraint).toBe('delivery_kind_known');
  });
});

describe('row-level security', () => {
  it('hides one customer’s deliveries from another', async () => {
    await log().record(invitation({ tenantId: ACME, to: 'ada@acme.example' }));
    await log().record(invitation({ tenantId: GLOBEX, to: 'grace@globex.example' }));

    const seen = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${GLOBEX}, true)`);
      return [...(await tx.execute(sql`SELECT to_email FROM messaging.delivery`))].map(
        (row) => row['to_email'],
      );
    });

    expect(seen).toEqual(['grace@globex.example']);
  });

  it('shows nothing at all with no tenant scope set', async () => {
    // The `NULLIF` form, doing its job. The obvious `current_setting(...)::uuid`
    // raises 22P02 on the empty string that `set_config(..., true)` leaves
    // behind, which turns every unscoped query into a 500 from a cast.
    await log().record(invitation());

    const rows = [...(await db.execute(sql`SELECT count(*) AS n FROM messaging.delivery`))];
    expect(Number(rows[0]?.['n'])).toBe(0);
  });

  it('refuses a write attributed to a different tenant than the scope', async () => {
    // WITH CHECK, not just USING. Without it a tenant can insert a row it will
    // then be unable to see — which is worse than a refusal, because nothing
    // reports it.
    const refused = await refusal(() =>
      db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${ACME}, true)`);
        await tx.execute(sql`
          INSERT INTO messaging.delivery (tenant_id, kind, to_email, provider, status)
          VALUES (${GLOBEX}::uuid, 'account_invitation', 'x@globex.example', 'resend', 'accepted')
        `);
      }),
    );
    // 42501, insufficient privilege. The policy, not a constraint.
    expect(refused.code).toBe('42501');
  });
});

describe('settling what a provider tells us later', () => {
  it('moves a message to bounced across the tenant boundary', async () => {
    // The whole point of the SECURITY DEFINER lookup: the webhook knows a
    // message id and nothing else, and the policy would otherwise hide the row
    // it needs to find.
    const messageId = 'msg_bounced_1';
    await log().record(invitation({ tenantId: GLOBEX, messageId }));

    const settled = await log().settle({
      provider: 'resend',
      providerMessageId: messageId,
      status: 'bounced',
      reason: 'email.bounced',
    });

    expect(settled).toBe(true);

    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${GLOBEX}, true)`);
      return [
        ...(await tx.execute(
          sql`SELECT status, reason FROM messaging.delivery WHERE provider_message_id = ${messageId}`,
        )),
      ];
    });

    expect(rows[0]?.['status']).toBe('bounced');
    expect(rows[0]?.['reason']).toBe('email.bounced');
  });

  it('reports a message it has never heard of, rather than throwing', async () => {
    // A provider replays events. One naming a message from before this table
    // existed is a fact about our history, and answering with an error would
    // make it retry forever.
    expect(
      await log().settle({
        provider: 'resend',
        providerMessageId: 'msg_from_another_life',
        status: 'delivered',
        reason: null,
      }),
    ).toBe(false);
  });

  it('does not move a delivered message backwards', async () => {
    // Providers do not guarantee order. A `delivered` arriving after a
    // `delivery_delayed` is normal, and applying them as they land would leave
    // a message that reached the mailbox recorded as still in trouble.
    const messageId = 'msg_ordering_1';
    await log().record(invitation({ messageId }));

    await log().settle({
      provider: 'resend',
      providerMessageId: messageId,
      status: 'delivered',
      reason: null,
    });
    const late = await log().settle({
      provider: 'resend',
      providerMessageId: messageId,
      status: 'failed',
      reason: 'email.failed',
    });

    expect(late).toBe(false);

    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${ACME}, true)`);
      return [
        ...(await tx.execute(
          sql`SELECT status FROM messaging.delivery WHERE provider_message_id = ${messageId}`,
        )),
      ];
    });
    expect(rows[0]?.['status']).toBe('delivered');
  });

  it('keeps one row per provider message', async () => {
    // The unique index. Two rows for one message would mean a webhook settling
    // whichever it found first.
    const messageId = 'msg_unique_1';
    await log().record(invitation({ messageId }));

    const refused = await refusal(() => log().record(invitation({ messageId })));
    expect(refused.code).toBe('23505');
    expect(refused.constraint).toBe('delivery_provider_message_key');
  });

  it('allows many rows with no provider message id', async () => {
    // The index is partial for this reason: a row the log transport wrote has
    // no id, no webhook will ever name it, and a full unique index would let
    // exactly one such row exist in the whole table.
    await log().record(invitation({ messageId: null }));
    await expect(log().record(invitation({ messageId: null }))).resolves.not.toBeNull();
  });
});

describe('what the table cannot hold', () => {
  it('has no column a message body could go in', async () => {
    // The design, asserted. The enrolment link is the one secret passing
    // through this service, and `platform.enrolment_token` stores only its
    // hash precisely so a backup or a support query yields nothing usable — a
    // rendered message here would undo that in one column.
    const columns = [
      ...(await admin.execute(sql`
        SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'messaging' AND table_name = 'delivery'
      `)),
    ].map((row) => String(row['column_name']));

    expect(columns.toSorted()).toEqual([
      'created_at',
      'id',
      'kind',
      'provider',
      'provider_message_id',
      'reason',
      'status',
      'tenant_id',
      'to_email',
      'updated_at',
    ]);
  });
});
