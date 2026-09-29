import { readdir, readFile } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { SettingsActivityRecorded } from '@kithena/contracts';
import { startPostgres } from '@kithena/testing';

import { drizzleActivity } from './drizzle-activity.js';
import { tenantTransaction } from './unit-of-work.js';

/**
 * A settings change reaches the central activity log (`docs/audit.md`) as
 * `people.settings.activity_recorded`, in People's outbox: raised with the
 * entry, once however often the command is retried, and — for the entries
 * written before it existed — by the backfill migration. Every envelope, live
 * or backfilled, has to parse against the contract, or the log refuses it.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const PRIYA = '00000000-0000-4000-8000-0000000000b1';
const SUPPORT = '00000000-0000-4000-8000-0000000000c1';
const OPERATOR = '00000000-0000-4000-8000-0000000000e1';
const OLD_V7 = '01890000-0000-7000-8000-000000000d01';
const OLD_V4 = '00000000-0000-4000-8000-000000000d02';
const OLD_KEYED = '01890000-0000-7000-8000-000000000d03';
const BACKFILL = '20260929160100_people_settings_activity_event.sql';

const migrations = new URL('../../../../migrations/', import.meta.url);
let stop: (() => Promise<void>) | undefined;
let admin: ReturnType<typeof postgres>;
let service: ReturnType<typeof postgres>;
let inTenant: ReturnType<typeof tenantTransaction>;

beforeAll(async () => {
  const pg = await startPostgres();
  stop = pg.stop;
  admin = postgres(pg.url, { max: 1, onnotice: () => {} });
  const files = (await readdir(migrations))
    .filter((f) => f === '20260821120000_tenant_registry.sql' || /^\d{14}_people_/.test(f))
    .filter((f) => f !== BACKFILL)
    .toSorted();
  for (const file of files) await admin.unsafe(await readFile(new URL(file, migrations), 'utf8'));
  // Two entries from before the event existed: one by support.
  await admin`
    INSERT INTO people.settings_activity
      (tenant_id, id, at, actor, action, area, idempotency_key, on_behalf_of, reason, subject)
    VALUES (${ACME}, ${OLD_V7}, '2026-09-01T09:30:00Z', ${SUPPORT}, 'Granted a role', 'roles',
            'old-1', ${OPERATOR}, 'Ticket 1', 'HR'),
           (${ACME}, ${OLD_V4}, '2026-09-02T09:30:00Z', ${PRIYA}, 'Added a field', 'fields',
            'old-2', NULL, NULL, 'Work phone'),
           (${ACME}, ${OLD_KEYED}, '2026-09-03T09:30:00Z', ${PRIYA},
            'Reordered the fields in a section', 'fields', 'old-3', NULL, NULL, 'contact')`;
  // What the key names now: the backfill says the label, not the key.
  await admin`
    INSERT INTO people.section (tenant_id, key, labels, origin)
    VALUES (${ACME}, 'contact', '{"default": "Contact details", "translations": {}}', 'tenant')`;
  await admin.unsafe(await readFile(new URL(BACKFILL, migrations), 'utf8'));
  await admin`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`;
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  service = postgres(asService.toString(), { max: 2 });
  inTenant = tenantTransaction(drizzle(service));
}, 180_000);

afterAll(async () => {
  await admin.end();
  await service.end();
  await stop?.();
});

async function events(): Promise<Record<string, unknown>[]> {
  const rows = await admin<{ envelope: Record<string, unknown> }[]>`
    SELECT envelope FROM people.outbox
     WHERE event_name = 'people.settings.activity_recorded' ORDER BY created_at, event_id`;
  return rows.map((r) => r.envelope);
}

describe('people.settings.activity_recorded', () => {
  it('is backfilled for every entry already kept, as the contract has it', async () => {
    const backfilled = await events();
    expect(backfilled).toHaveLength(3);
    for (const envelope of backfilled) {
      expect(SettingsActivityRecorded.safeParse(envelope).error).toBeUndefined();
    }
    const bySupport = backfilled.find((e) => e['eventId'] === OLD_V7);
    expect(bySupport).toMatchObject({
      occurredAt: '2026-09-01T09:30:00.000Z',
      actor: { kind: 'user', userId: SUPPORT, onBehalfOf: OPERATOR },
      payload: { area: 'roles', action: 'Granted a role', subject: 'HR', reason: 'Ticket 1' },
    });
    expect(backfilled.find((e) => e['eventId'] === OLD_KEYED)).toMatchObject({
      payload: { subject: 'Contact details' },
    });
    // Not a v7, so not its own id: a fresh v7 stands in.
    expect(backfilled.some((e) => e['eventId'] === OLD_V4)).toBe(false);
  });

  it('is raised with a new entry, under the entry’s id, and not again for a retry', async () => {
    const store = drizzleActivity();
    const id = '01890000-0000-7000-8000-000000000e01';
    const record = () =>
      inTenant(ACME, ({ tx }) =>
        store.record(tx, ACME, {
          id,
          at: '2026-09-29T10:00:00.000Z',
          actor: PRIYA,
          action: 'Changed a field',
          subject: 'Work phone',
          detail: 'Seen by: HR → HR and their manager.',
          area: 'fields',
          idempotencyKey: 'live',
        }),
      );
    await record();
    await record();
    const live = (await events()).filter((e) => e['eventId'] === id);
    expect(live).toHaveLength(1);
    expect(SettingsActivityRecorded.safeParse(live[0]).error).toBeUndefined();
    expect(live[0]).toMatchObject({
      actor: { kind: 'user', userId: PRIYA },
      payload: { detail: 'Seen by: HR → HR and their manager.', reason: null },
    });
  });
});
