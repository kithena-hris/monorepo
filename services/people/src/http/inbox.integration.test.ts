import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { startPostgres } from '@kithena/testing';

import { define, versionOf } from '../application/person/in-memory.js';
import { drizzleSchemaRepository } from '../infrastructure/drizzle-schema-repository.js';
import { tenantTransaction } from '../infrastructure/unit-of-work.js';
import { wirePeople } from './server.js';

/**
 * People's Inbox (INB-020 to INB-027), booted as `main.ts` boots People: HR
 * asks somebody for a detail, it is a task in their Inbox with the field
 * inline and a request with progress in HR's; a question on it is news for
 * HR; filling it in finishes both, Undo opens it again, sending it back needs
 * a reason, and a cancelled one stays in To do for the day, dimmed.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const GRACE = '00000000-0000-4000-8000-0000000000a1';
const TIM = '00000000-0000-4000-8000-0000000000a3';
const GRACE_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const TIM_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';
const migrations = new URL('../../../../migrations/', import.meta.url);

const stops: (() => Promise<void>)[] = [];
const clients: ReturnType<typeof postgres>[] = [];
let server: Server;
let base = '';

const as = (account: string, roles: string[] = []) => ({
  'content-type': 'application/json',
  'x-internal-token': 'router-secret',
  'x-kithena-principal': JSON.stringify({
    userId: account,
    tenantId: ACME,
    roles,
    entitlements: ['module.people'],
  }),
});
const grace = as(GRACE_ACCOUNT, ['hr']);
const tim = as(TIM_ACCOUNT);

beforeAll(async () => {
  const pg = await startPostgres();
  stops.push(pg.stop);
  const adminClient = postgres(pg.url, { max: 1 });
  clients.push(adminClient);
  const admin = drizzle(adminClient);
  const files = (await readdir(migrations))
    .filter((f) => f === '20260821120000_tenant_registry.sql' || /^\d{14}_people_/.test(f))
    .toSorted();
  for (const file of files) {
    await admin.execute(sql.raw(await readFile(new URL(file, migrations), 'utf8')));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const service = new URL(pg.url);
  service.username = 'svc_people';
  service.password = 'svc_people';
  const serviceClient = postgres(service.toString(), { max: 2 });
  clients.push(serviceClient);

  const everyone = ['self', 'manager', 'hr', 'directory'] as const;
  await tenantTransaction(drizzle(serviceClient))(ACME, ({ tx }) =>
    drizzleSchemaRepository().appendVersion(
      tx,
      ACME,
      versionOf(1, [
        define({ key: 'given_name', visibility: [...everyone] }),
        define({ key: 'family_name', visibility: [...everyone] }),
        define({ key: 'work_email', visibility: [...everyone] }),
        define({
          key: 'emergency_phone',
          label: { default: 'Emergency contact' },
          ownership: ['employee', 'hr'],
          visibility: ['self', 'hr'],
        }),
      ]),
      [],
      '2000-01-01',
    ),
  );
  await admin.execute(sql`
    INSERT INTO people.person
      (tenant_id, id, status, hire_date, identity_account_id, manager_id,
       given_name, family_name, work_email, custom, schema_version)
    VALUES
      (${ACME}::uuid, ${GRACE}::uuid, 'active', '2020-01-06', ${GRACE_ACCOUNT}::uuid, NULL,
       'Grace', 'Hopper', 'grace@acme.test', '{}'::jsonb, 1),
      (${ACME}::uuid, ${TIM}::uuid, 'active', '2022-05-02', ${TIM_ACCOUNT}::uuid, NULL,
       'Tim', 'Berners-Lee', 'tim@acme.test', '{}'::jsonb, 1)`);

  process.env['PEOPLE_DATABASE_URL'] = service.toString();
  process.env['PEOPLE_API_TOKEN'] = 'router-secret';
  process.env['PEOPLE_SECRET_KEYS'] = `k1:${randomBytes(32).toString('base64')}`;

  server = createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  wirePeople(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}, 180_000);

afterAll(async () => {
  const listening = server as Server | undefined;
  if (listening) await new Promise((resolve) => listening.close(resolve));
  for (const c of clients) await c.end();
  await Promise.all(stops.map((stop) => stop()));
});

const call = async (
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...headers, ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

type Item = {
  id: string;
  lane: string;
  kind: string;
  title: string;
  status: { label: string } | null;
  outcome: { label: string } | null;
  replies: number;
  due: string | null;
  message: string | null;
  detail: Record<string, unknown>;
};
const inbox = async (headers: Record<string, string>): Promise<Item[]> => {
  const read = await call('GET', '/v1/views/inbox', headers);
  expect(read.status).toBe(200);
  return read.body['items'] as Item[];
};
const ask = async (message: string | null = null) => {
  const sent = await call('POST', '/v1/asks', grace, {
    personIds: [TIM],
    keys: ['emergency_phone'],
    message,
    dueOn: '2030-10-15',
  });
  expect(sent).toMatchObject({ status: 200, body: { asked: 1, skipped: 0 } });
  const batchId = sent.body['batchId'] as string;
  const task = (await inbox(tim)).find(
    (i) => i.kind === 'people.details' && i.lane === 'task' && i.status === null,
  );
  return { batchId, askId: task?.id.split(':')[2] ?? '' };
};

describe('People in the Inbox', () => {
  it('is a task with the field inline for the person asked, and a request with progress for HR', async () => {
    const { batchId, askId } = await ask('We need it before the offsite. Thanks!');
    const task = (await inbox(tim)).find((i) => i.id === `people:details:${askId}`);
    expect(task).toMatchObject({
      lane: 'task',
      title: 'Add your emergency contact',
      due: '2030-10-15',
      message: 'We need it before the offsite. Thanks!',
      detail: { fields: [{ key: 'emergency_phone', label: 'Emergency contact', value: null }] },
    });
    expect((await inbox(grace)).find((i) => i.id === `people:asked:${batchId}`)).toMatchObject({
      lane: 'request',
      status: { label: '0 of 1 done' },
      detail: { total: 1, done: 0, people: [{ name: 'Tim Berners-Lee', state: 'open' }] },
    });

    // C7: a question stays on the task, and is news for whoever asked.
    expect(
      (await call('POST', `/v1/asks/${askId}/replies`, tim, { body: 'Can it be my partner?' }))
        .status,
    ).toBe(200);
    expect((await inbox(grace)).find((i) => i.id === `people:question:${askId}`)).toMatchObject({
      lane: 'update',
      title: 'Tim Berners-Lee asked about your request',
    });

    // C1: filled in from the Inbox, it is on the record and done for both.
    const done = await call('POST', `/v1/asks/${askId}/completion`, tim, {
      values: { emergency_phone: '+420 601 123 456' },
    });
    expect(done).toMatchObject({ status: 200, body: { held: [] } });
    expect((await inbox(tim)).find((i) => i.id === `people:details:${askId}`)).toMatchObject({
      lane: 'done',
      outcome: { label: 'Done' },
    });
    const hr = await inbox(grace);
    expect(hr.find((i) => i.id === `people:asked:${batchId}`)).toMatchObject({
      lane: 'done',
    });
    expect(hr.find((i) => i.id === `people:answered:${askId}`)).toMatchObject({
      lane: 'update',
      title: 'Tim Berners-Lee added what you asked for',
    });

    // C5: Undo puts back what was there and opens the task again.
    expect(
      (await call('POST', `/v1/asks/${askId}/undo`, tim, { values: { emergency_phone: null } }))
        .status,
    ).toBe(200);
    expect((await inbox(tim)).find((i) => i.id === `people:details:${askId}`)).toMatchObject({
      lane: 'task',
      outcome: null,
    });

    // C8: sending it back needs a reason; "something else" needs words too.
    expect(
      (await call('POST', `/v1/asks/${askId}/send-back`, tim, { reason: 'other' })).status,
    ).toBe(422);
    expect(
      (
        await call('POST', `/v1/asks/${askId}/send-back`, tim, {
          reason: 'other',
          note: 'I would rather add my brother next week.',
        })
      ).status,
    ).toBe(200);
    expect((await inbox(tim)).find((i) => i.id === `people:details:${askId}`)).toMatchObject({
      lane: 'done',
      outcome: { label: 'Sent back' },
    });
    expect((await inbox(grace)).find((i) => i.id === `people:answered:${askId}`)).toMatchObject({
      title: 'Tim Berners-Lee sent your request back',
      message: 'I would rather add my brother next week.',
    });
  });

  it('stays in To do, dimmed, the day whoever asked cancels it; only they may', async () => {
    const { askId } = await ask();
    expect((await call('POST', `/v1/asks/${askId}/cancellation`, tim, {})).status).toBe(403);
    expect(
      (await call('POST', `/v1/asks/${askId}/cancellation`, grace, { note: 'Found it.' })).status,
    ).toBe(200);
    expect((await inbox(tim)).find((i) => i.id === `people:details:${askId}`)).toMatchObject({
      lane: 'task',
      status: { label: 'Cancelled by Grace' },
      outcome: { label: 'Cancelled' },
      due: null,
    });
  });

  it('tracks a batch: remind, change the due date, cancel for everyone', async () => {
    const { batchId } = await ask();
    expect(
      (await call('POST', `/v1/ask-batches/${batchId}/due`, grace, { dueOn: '2030-11-01' }))
        .status,
    ).toBe(200);
    expect((await call('POST', `/v1/ask-batches/${batchId}/reminders`, grace, {})).status).toBe(
      200,
    );
    expect((await inbox(grace)).find((i) => i.id === `people:asked:${batchId}`)).toMatchObject({
      due: '2030-11-01',
    });
    // Nobody else's batch is theirs to change.
    expect((await call('POST', `/v1/ask-batches/${batchId}/cancellation`, tim, {})).status).toBe(
      404,
    );
    expect(
      (await call('POST', `/v1/ask-batches/${batchId}/cancellation`, grace, {})).status,
    ).toBe(200);
    expect((await inbox(grace)).find((i) => i.id === `people:asked:${batchId}`)).toMatchObject({
      lane: 'done',
      outcome: { label: 'Cancelled' },
    });
  });
});
