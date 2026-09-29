import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeJwt } from 'jose';

import { companyRequest, composed, type Composed } from '../testing/composed.js';

/**
 * Viewing as an employee at the wire: People starts it for an administrator,
 * the tenant app redeems the code, and the session that results is the
 * employee's, thirty minutes long, audited in the transaction that makes it,
 * holding no slot, unable to write, and ended exactly once.
 */

let identity: Composed;
let tenantId = '';
let admin = '';
let employee = '';
let colleague = '';
let supportAccount = '';
/** The administrator's own session, which viewing must leave alone. */
let adminSession = '';
/** The employee's own four devices. */
let employeeSessions: string[] = [];

const START = '/api/internal/view-as/start';

async function person(email: string): Promise<string> {
  const [row] = await identity.sql<{ id: string }[]>`
    WITH i AS (INSERT INTO platform.identity (id) VALUES (gen_random_uuid()) RETURNING id)
    INSERT INTO platform.account
      (id, tenant_id, identity_id, status, work_email, given_name, family_name, time_zone,
       employment_start)
    SELECT gen_random_uuid(), ${tenantId}::uuid, id, 'active', ${email},
           initcap(split_part(${email}, '@', 1)), 'Example', 'Europe/Madrid', '2026-01-01'
      FROM i RETURNING id`;
  return row?.id ?? '';
}

async function ownSession(accountId: string, slot: number): Promise<string> {
  const [row] = await identity.sql<{ id: string }[]>`
    INSERT INTO platform.session
      (id, tenant_id, account_id, slot, started_at, last_seen_at, expires_at, amr)
    VALUES (gen_random_uuid(), ${tenantId}::uuid, ${accountId}::uuid, ${slot}, now(), now(),
            now() + interval '30 days', ARRAY['hwk'])
    RETURNING id`;
  return row?.id ?? '';
}

beforeAll(async () => {
  identity = await composed({ defaultEntitlements: [] });
  const created = await identity.call('POST', '/api/internal/admin/tenants', companyRequest('acme'));
  tenantId = String(created.body['tenantId']);

  admin = await person('grace@acme.example');
  employee = await person('alan@acme.example');
  colleague = await person('lin@acme.example');
  const [support] = await identity.sql<{ id: string }[]>`
    WITH i AS (INSERT INTO platform.identity (id) VALUES (gen_random_uuid()) RETURNING id)
    INSERT INTO platform.account
      (id, tenant_id, identity_id, status, kind, work_email, time_zone, employment_start)
    SELECT gen_random_uuid(), ${tenantId}::uuid, id, 'active', 'support',
           'support@acme.support.kithena.invalid', 'Etc/UTC', current_date FROM i RETURNING id`;
  supportAccount = support?.id ?? '';

  adminSession = await ownSession(admin, 1);
  employeeSessions = [
    await ownSession(employee, 1),
    await ownSession(employee, 2),
    await ownSession(employee, 3),
    await ownSession(employee, 4),
  ];
});

afterAll(async () => {
  await (identity as Composed | undefined)?.stop();
});

function start(body: Record<string, unknown> = {}) {
  return identity.call('POST', START, {
    tenantId,
    adminAccountId: admin,
    subjectAccountId: employee,
    reason: 'Checking what Alan sees on payday',
    specialCategory: true,
    ...body,
  });
}

/** Started and redeemed, as the tenant app does: the session id. */
async function viewing(body: Record<string, unknown> = {}): Promise<string> {
  const started = await start(body);
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const redeemed = await identity.call('POST', '/api/internal/handoff/redeem', {
    code: started.body['code'],
    tenantId,
  });
  return String(redeemed.body['sessionId']);
}

const signOut = (sessionId: string) =>
  identity.call('POST', '/api/internal/session/revoke', { sessionId, tenantId });

const endedEvents = async (sessionId: string) =>
  (await identity.events('identity.view_as.ended')).filter((p) => p['sessionId'] === sessionId);

describe('starting to view as an employee', () => {
  it('signs in as the employee, for thirty minutes, with no slot, naming the administrator', async () => {
    const sessionId = await viewing();

    const [row] = await identity.sql<
      { account_id: string; slot: number | null; amr: string[]; viewed_by: string; impersonated_by: string | null; reason: string; span: string }[]
    >`
      SELECT account_id, slot, amr, viewed_by, impersonated_by, reason,
             (expires_at - started_at)::text AS span
        FROM platform.session WHERE id = ${sessionId}::uuid`;
    expect(row).toEqual({
      account_id: employee,
      slot: null,
      amr: ['view_as'],
      viewed_by: admin,
      impersonated_by: null,
      reason: 'Checking what Alan sees on payday',
      span: '00:30:00',
    });
    await signOut(sessionId);
  });

  it('leaves the employee’s own sessions and slots, and the administrator’s, untouched', async () => {
    const before = await identity.sql<{ id: string }[]>`
      SELECT id, slot, expires_at FROM platform.session
       WHERE account_id IN (${employee}::uuid, ${admin}::uuid) AND viewed_by IS NULL ORDER BY id`;

    // More than the employee has slots, started and ended.
    for (let i = 0; i < 5; i += 1) await signOut(await viewing());

    const after = await identity.sql<{ id: string }[]>`
      SELECT id, slot, expires_at FROM platform.session
       WHERE account_id IN (${employee}::uuid, ${admin}::uuid) AND viewed_by IS NULL ORDER BY id`;
    expect(after).toEqual(before);
    expect(before.map((r) => r.id)).toEqual(
      expect.arrayContaining([...employeeSessions, adminSession]),
    );
    // The administrator's own session still signs them in.
    const own = await identity.call('POST', '/api/internal/session', {
      sessionId: adminSession,
      tenantId,
    });
    expect(own.status).toBe(200);
    expect(own.body['viewing']).toBeNull();
  });

  it('is announced to the activity log in the transaction that creates it', async () => {
    const sessionId = await viewing({ reason: 'Ticket 77', specialCategory: false });

    const [record] = await identity.sql`
      SELECT admin_account_id, subject_account_id, reason, special_category
        FROM platform.view_as_access WHERE session_id = ${sessionId}::uuid`;
    expect(record).toEqual({
      admin_account_id: admin,
      subject_account_id: employee,
      reason: 'Ticket 77',
      special_category: false,
    });
    const started = (await identity.events('identity.view_as.started')).find(
      (p) => p['sessionId'] === sessionId,
    );
    expect(started).toMatchObject({
      adminAccountId: admin,
      subjectAccountId: employee,
      reason: 'Ticket 77',
      specialCategory: false,
    });
    await signOut(sessionId);
  });

  it('leaves no session behind when its record cannot be written', async () => {
    await identity.sql.unsafe(`
      CREATE OR REPLACE FUNCTION public.view_as_refuse() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$;
      CREATE TRIGGER view_as_refuse BEFORE INSERT ON platform.view_as_access
        FOR EACH ROW EXECUTE FUNCTION public.view_as_refuse();`);
    const sessions = async () =>
      (
        await identity.sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM platform.session WHERE viewed_by IS NOT NULL`
      )[0]?.n;
    const events = async () => (await identity.events('identity.view_as.started')).length;
    const [sessionsBefore, eventsBefore] = [await sessions(), await events()];

    const refused = await start();

    await identity.sql.unsafe(`DROP TRIGGER view_as_refuse ON platform.view_as_access`);
    expect(refused.status).toBe(500);
    expect(await sessions()).toBe(sessionsBefore);
    expect(await events()).toBe(eventsBefore);
  });

  it('requires a reason', async () => {
    const refused = await start({ reason: '  ' });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'VIEW_AS_REASON_REQUIRED' });
    expect((await start({ reason: 'x'.repeat(501) })).status).toBe(400);
  });

  it('is never of oneself, never of or by Kithena support, and only of this company’s people', async () => {
    expect((await start({ subjectAccountId: admin })).body).toMatchObject({ code: 'VIEW_AS_SELF' });
    expect((await start({ subjectAccountId: supportAccount })).body).toMatchObject({
      code: 'VIEW_AS_SUPPORT',
    });
    expect((await start({ adminAccountId: supportAccount })).body).toMatchObject({
      code: 'VIEW_AS_SUPPORT',
    });
    const stranger = await start({ subjectAccountId: '00000000-0000-4000-8000-00000000dead' });
    expect(stranger.status).toBe(403);
    expect(stranger.body).toMatchObject({ code: 'VIEW_AS_UNKNOWN_ACCOUNT' });
  });
});

describe('a view-as session', () => {
  it('tells the tenant app whose view it is', async () => {
    const sessionId = await viewing();
    const asked = await identity.call('POST', '/api/internal/session', { sessionId, tenantId });
    expect(asked.status).toBe(200);
    expect(asked.body['accountId']).toBe(employee);
    expect(asked.body['viewing']).toEqual({ adminAccountId: admin, adminName: 'Grace Example' });
    await signOut(sessionId);
  });

  it('carries the administrator as a view-as actor, and no token outlives it', async () => {
    const sessionId = await viewing();
    await identity.sql`
      UPDATE platform.session SET expires_at = now() + interval '2 minutes'
       WHERE id = ${sessionId}::uuid`;

    const minted = await identity.call('POST', '/api/internal/session/token', {
      sessionId,
      tenantId,
    });
    const claims = decodeJwt(String(minted.body['accessToken']));
    expect(claims['sub']).toBe(employee);
    expect(claims['act']).toEqual({ sub: admin, kind: 'view_as' });
    expect(claims['amr']).toEqual(['view_as']);
    const [row] = await identity.sql<{ ends: number }[]>`
      SELECT extract(epoch FROM expires_at)::float8 AS ends FROM platform.session
       WHERE id = ${sessionId}::uuid`;
    expect(Number(claims['exp'])).toBeLessThanOrEqual(Number(row?.ends));
    expect(Date.parse(String(minted.body['expiresAt'])) / 1000).toBeLessThanOrEqual(
      Number(row?.ends),
    );
    await signOut(sessionId);
  });

  it('can never be stretched past thirty minutes, by anybody', async () => {
    const sessionId = await viewing();
    await expect(identity.sql`
      UPDATE platform.session SET expires_at = started_at + interval '31 minutes'
       WHERE id = ${sessionId}::uuid`).rejects.toThrow(/session_shape/);
    await expect(identity.sql`
      UPDATE platform.view_as_access SET expires_at = started_at + interval '31 minutes'
       WHERE session_id = ${sessionId}::uuid`).rejects.toThrow(/view_as_access_thirty_minutes/);
    await signOut(sessionId);
  });

  it('ends when its thirty minutes do, and the end is recorded once, by the next session check', async () => {
    const sessionId = await viewing();
    const ask = () => identity.call('POST', '/api/internal/session', { sessionId, tenantId });
    expect((await ask()).status).toBe(200);

    // Thirty-one minutes later.
    for (const table of ['session', 'view_as_access'] as const) {
      const key = table === 'session' ? 'id' : 'session_id';
      await identity.sql.unsafe(
        `UPDATE platform.${table}
            SET started_at = now() - interval '31 minutes',
                expires_at = now() - interval '1 minute'
                ${table === 'session' ? ", last_seen_at = now() - interval '31 minutes'" : ''}
          WHERE ${key} = $1::uuid`,
        [sessionId],
      );
    }

    expect((await ask()).status).toBe(401);
    const token = await identity.call('POST', '/api/internal/session/token', {
      sessionId,
      tenantId,
    });
    expect(token.status).toBe(401);
    // Anybody's check closes it — here the employee's own device's.
    await identity.call('POST', '/api/internal/session', {
      sessionId: employeeSessions[0],
      tenantId,
    });
    await ask();
    const ended = await endedEvents(sessionId);
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({
      adminAccountId: admin,
      subjectAccountId: employee,
      endedBy: 'time_limit',
      specialCategory: true,
    });
  });

  it('is ended by signing it out, recorded once, and nothing of the employee’s goes with it', async () => {
    const sessionId = await viewing();

    expect((await signOut(sessionId)).status).toBe(204);
    expect((await signOut(sessionId)).status).toBe(204);

    const ended = await endedEvents(sessionId);
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ endedBy: 'admin', reason: 'Checking what Alan sees on payday' });
    const [gone] = await identity.sql`SELECT 1 FROM platform.session WHERE id = ${sessionId}::uuid`;
    expect(gone).toBeUndefined();
    const [record] = await identity.sql`
      SELECT ended_by FROM platform.view_as_access WHERE session_id = ${sessionId}::uuid`;
    expect(record).toEqual({ ended_by: 'admin' });
    const own = await identity.sql<{ id: string }[]>`
      SELECT id FROM platform.session
       WHERE account_id = ${employee}::uuid AND viewed_by IS NULL ORDER BY slot`;
    expect(own.map((r) => r.id)).toEqual(employeeSessions);
  });

  it('cannot start another one, nor sign in as support', async () => {
    const sessionId = await viewing();

    // From inside the view the principal is the employee's: People would ask
    // with the employee as the administrator.
    const nested = await start({ adminAccountId: employee, subjectAccountId: colleague });
    expect(nested.status).toBe(403);
    expect(nested.body).toMatchObject({ code: 'VIEW_AS_NESTED' });

    // A tenant session is not a back-office one, whatever it is presented as.
    const support = await identity.call('POST', '/api/internal/support/start', {
      operatorSessionId: sessionId,
      tenantId,
      reason: 'From inside a view',
    });
    expect(support.status).toBe(401);
    await signOut(sessionId);
  });

  it('cannot change the employee’s preferences, which their own session can', async () => {
    const sessionId = await viewing();
    const put = (session: string) =>
      identity.call('PUT', `/api/internal/tenants/${tenantId}/accounts/${employee}/preferences/shortcuts`, {
        value: { characterKeys: false },
        sessionId: session,
      });

    expect((await put(sessionId)).status).toBe(403);
    expect((await put(employeeSessions[0] ?? '')).status).toBe(204);
    await signOut(sessionId);
  });
});
