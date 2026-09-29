import { readFile } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { startPostgres } from '@kithena/testing';

import { drizzleActivity } from './drizzle-activity.js';
import { tenantTransaction } from './unit-of-work.js';

/**
 * `people.settings_activity` against its migrations, the support columns
 * (20260929140000) included: Kithena support's entries keep the operator
 * and the reason, everybody else's keep neither, and entries written before
 * the columns read back with both null.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const PRIYA = '00000000-0000-4000-8000-0000000000b1';
const SUPPORT = '00000000-0000-4000-8000-0000000000c1';
const OPERATOR = '00000000-0000-4000-8000-0000000000e1';

let stop: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let inTenant: ReturnType<typeof tenantTransaction>;
let admin: ReturnType<typeof drizzle>;
const store = drizzleActivity();

beforeAll(async () => {
  const pg = await startPostgres();
  stop = pg.stop;
  const adminClient = postgres(pg.url, { max: 1 });
  clients.push(adminClient);
  admin = drizzle(adminClient);
  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260922140000_people_bootstrap.sql',
    // For `people.outbox`: an entry raises its event there (`docs/audit.md`).
    '20260922170000_people_person.sql',
    '20260927190000_people_settings_activity.sql',
    '20260927200200_people_settings_activity_detail.sql',
  ]) {
    const text = await readFile(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8');
    await admin.execute(sql.raw(text));
  }
  // An entry from before support was recorded, written straight to the table.
  await admin.execute(sql`
    INSERT INTO people.settings_activity (tenant_id, id, at, actor, action, area, idempotency_key)
    VALUES (${ACME}::uuid, '00000000-0000-4000-8000-000000000d00', '2026-09-01T00:00:00Z',
            ${PRIYA}::uuid, 'Added a field', 'fields', 'before')`);
  const support = await readFile(
    new URL(
      '../../../../migrations/20260929140000_people_settings_activity_support.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await admin.execute(sql.raw(support));
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  const service = postgres(asService.toString(), { max: 2 });
  clients.push(service);
  inTenant = tenantTransaction(drizzle(service));
}, 120_000);

afterAll(async () => {
  await Promise.all(clients.map((c) => c.end()));
  await stop?.();
});

const entry = {
  action: 'Granted a role',
  subject: null,
  detail: null,
  area: 'roles' as const,
};

describe('the settings activity log, and Kithena support', () => {
  it('keeps the operator and the reason on support’s entries, and neither on anybody else’s', async () => {
    await inTenant(ACME, ({ tx }) =>
      store.record(tx, ACME, {
        ...entry,
        id: '00000000-0000-4000-8000-000000000d01',
        at: '2026-09-29T10:00:00.000Z',
        actor: SUPPORT,
        onBehalfOf: OPERATOR,
        reason: 'Ticket 4812',
        idempotencyKey: 'support',
      }),
    );
    await inTenant(ACME, ({ tx }) =>
      store.record(tx, ACME, {
        ...entry,
        id: '00000000-0000-4000-8000-000000000d02',
        at: '2026-09-29T11:00:00.000Z',
        actor: PRIYA,
        idempotencyKey: 'priya',
      }),
    );
    const page = await inTenant(ACME, ({ tx }) =>
      store.page(tx, ACME, { before: null, limit: 10, area: null }),
    );
    expect(page.map((e) => [e.actor, e.onBehalfOf, e.reason])).toEqual([
      [PRIYA, null, null],
      [SUPPORT, OPERATOR, 'Ticket 4812'],
      [PRIYA, null, null],
    ]);
  });

  it('refuses a reason longer than the back office accepts', async () => {
    await expect(
      inTenant(ACME, ({ tx }) =>
        store.record(tx, ACME, {
          ...entry,
          id: '00000000-0000-4000-8000-000000000d03',
          at: '2026-09-29T12:00:00.000Z',
          actor: SUPPORT,
          onBehalfOf: OPERATOR,
          reason: 'x'.repeat(501),
          idempotencyKey: 'essay',
        }),
      ),
    ).rejects.toThrow();
  });
});
