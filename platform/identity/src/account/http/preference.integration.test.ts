import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';

import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@kithena/db-kit';
import { startPostgres } from '@kithena/testing';

import {
  hasAccount,
  readPreference,
  writePreference,
} from '../infrastructure/preference-store.js';
import { preferenceRoutes } from './preference-routes.js';

/**
 * A person's preferences through the route, against the real table and its
 * row-level security: saved, read back, replaced, and never reachable from
 * another company.
 */

const TOKEN = 'dev-only-key';
const TENANT = '00000000-0000-4000-8000-00000000000a';
const OTHER_TENANT = '00000000-0000-4000-8000-00000000000b';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const GLOBEX_ADA = '00000000-0000-4000-8000-0000000000a2';

let stop: (() => Promise<void>) | undefined;
let adminClient: ReturnType<typeof postgres> | undefined;
let serviceClient: ReturnType<typeof postgres> | undefined;
let db: PostgresJsDatabase;

beforeAll(async () => {
  const started = await startPostgres();
  stop = started.stop;
  adminClient = postgres(started.url, { max: 1 });
  const admin = drizzle(adminClient);
  // The migration grants to the service role, which the stack makes before Atlas runs.
  await admin.execute(sql`CREATE ROLE svc_identity NOLOGIN`);
  for (const file of [
    '20260821120000_tenant_registry.sql',
    '20260821230000_identity.sql',
    '20260929140000_account_preference.sql',
  ]) {
    const path = new URL(`../../../../../migrations/${file}`, import.meta.url);
    await admin.execute(sql.raw(await readFile(path, 'utf8')));
  }
  await admin.execute(sql`
    INSERT INTO platform.tenant (id, slug, display_name, status) VALUES
      (${TENANT}::uuid, 'acme', 'Acme', 'active'),
      (${OTHER_TENANT}::uuid, 'globex', 'Globex', 'active')
  `);
  await admin.execute(sql`
    INSERT INTO platform.identity (id) VALUES
      ('00000000-0000-4000-8000-0000000000d1'::uuid), ('00000000-0000-4000-8000-0000000000d2'::uuid)
  `);
  await admin.execute(sql`
    INSERT INTO platform.account
      (id, tenant_id, identity_id, status, work_email, time_zone, employment_start, session_limit)
    VALUES
      (${ADA}::uuid, ${TENANT}::uuid, '00000000-0000-4000-8000-0000000000d1'::uuid, 'active',
       'ada@acme.example', 'Europe/Madrid', '2026-01-01', 4),
      (${GLOBEX_ADA}::uuid, ${OTHER_TENANT}::uuid, '00000000-0000-4000-8000-0000000000d2'::uuid,
       'active', 'ada@globex.example', 'Europe/Madrid', '2026-01-01', 4)
  `);

  // A non-superuser, so row-level security is enforced rather than bypassed.
  await admin.execute(sql`CREATE ROLE svc_test LOGIN PASSWORD 'svc_test' NOBYPASSRLS`);
  await admin.execute(sql`GRANT USAGE ON SCHEMA platform TO svc_test`);
  await admin.execute(sql`GRANT SELECT ON ALL TABLES IN SCHEMA platform TO svc_test`);
  await admin.execute(
    sql`GRANT INSERT, UPDATE ON platform.account_preference TO svc_test`,
  );
  const asService = new URL(started.url);
  asService.username = 'svc_test';
  asService.password = 'svc_test';
  serviceClient = postgres(asService.toString(), { max: 2 });
  db = drizzle(serviceClient);
}, 180_000);

afterAll(async () => {
  await serviceClient?.end();
  await adminClient?.end();
  await stop?.();
});

/** The route as `composition.ts` wires it, over the test's database. */
const routes = preferenceRoutes({
  internalToken: TOKEN,
  read: (tenantId, accountId, name) =>
    withTenant(db, tenantId, async (tx) =>
      (await hasAccount(tx, accountId)) ? readPreference(tx, accountId, name) : undefined,
    ),
  write: (tenantId, accountId, name, value) =>
    withTenant(db, tenantId, async (tx) => {
      if (!(await hasAccount(tx, accountId))) return false;
      await writePreference(tx, tenantId, accountId, name, value);
      return true;
    }),
});

async function call(
  method: 'GET' | 'PUT',
  url: string,
  body?: unknown,
  token: string | null = TOKEN,
): Promise<{ status: number | undefined; body: unknown }> {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const request = {
    url,
    method,
    headers: token === null ? {} : { 'x-internal-token': token },
    [Symbol.asyncIterator]: () => chunks.values(),
  } as unknown as IncomingMessage;
  let status: number | undefined;
  let payload: string | undefined;
  const response = {
    writeHead(code: number) {
      status = code;
      return this;
    },
    end(chunk?: string) {
      if (typeof chunk === 'string') payload = chunk;
      return this;
    },
  } as unknown as ServerResponse;
  await routes(request, response);
  return { status, body: payload === undefined ? undefined : (JSON.parse(payload) as unknown) };
}

const path = (tenant: string, accountId: string) =>
  `/api/internal/tenants/${tenant}/accounts/${accountId}/preferences/shortcuts`;

describe('a person’s preferences', () => {
  it('is nothing until set, then what was saved, then what replaced it', async () => {
    expect(await call('GET', path(TENANT, ADA))).toEqual({ status: 200, body: { value: null } });

    const first = { bindings: { 'go.directory': ['g', 'e'] }, characterKeys: true };
    expect((await call('PUT', path(TENANT, ADA), { value: first })).status).toBe(204);
    expect(await call('GET', path(TENANT, ADA))).toEqual({ status: 200, body: { value: first } });

    // Resetting everything is saving the defaults: the row is replaced, not added to.
    const reset = { bindings: {}, characterKeys: false };
    expect((await call('PUT', path(TENANT, ADA), { value: reset })).status).toBe(204);
    expect(await call('GET', path(TENANT, ADA))).toEqual({ status: 200, body: { value: reset } });
  });

  it('never reaches an account of another company, reading or writing', async () => {
    expect((await call('GET', path(TENANT, GLOBEX_ADA))).status).toBe(404);
    expect(
      (await call('PUT', path(TENANT, GLOBEX_ADA), { value: { characterKeys: false } })).status,
    ).toBe(404);
    // Globex's Ada is untouched: nothing was written for her under Acme's name.
    expect(await call('GET', path(OTHER_TENANT, GLOBEX_ADA))).toEqual({
      status: 200,
      body: { value: null },
    });
  });

  it('refuses a caller without the token, a value that is not an object, and one too large', async () => {
    expect((await call('GET', path(TENANT, ADA), undefined, null)).status).toBe(401);
    expect((await call('PUT', path(TENANT, ADA), { value: ['g'] })).status).toBe(400);
    expect(
      (await call('PUT', path(TENANT, ADA), { value: { pad: 'x'.repeat(17_000) } })).status,
    ).toBe(413);
  });
});
