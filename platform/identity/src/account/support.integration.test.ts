import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeJwt } from 'jose';

import { companyRequest, composed, type Composed } from '../testing/composed.js';

/**
 * Support access at the wire: the back office starts it with an operator's
 * session, the tenant app redeems the code, and the session that results is
 * an hour long, audited, holds no slot and is the only way in.
 */

let identity: Composed;
let tenantId = '';
let operatorId = '';
let operatorSession = '';

const START = '/api/internal/support/start';

beforeAll(async () => {
  identity = await composed({ defaultEntitlements: [] });

  const created = await identity.call(
    'POST',
    '/api/internal/admin/tenants',
    companyRequest('acme'),
  );
  tenantId = String(created.body['tenantId']);

  const [op] = await identity.sql<{ id: string }[]>`
    WITH i AS (INSERT INTO platform.identity (id) VALUES (gen_random_uuid()) RETURNING id)
    INSERT INTO platform.operator (identity_id, email, status)
    SELECT id, 'grace@kithena.example', 'active' FROM i RETURNING id`;
  operatorId = op?.id ?? '';
  operatorSession = await sessionFor(operatorId);
});

afterAll(async () => {
  await (identity as Composed | undefined)?.stop();
});

async function sessionFor(
  operator: string,
  over: { expiresIn?: string; revoked?: boolean } = {},
): Promise<string> {
  const [row] = await identity.sql<{ id: string }[]>`
    INSERT INTO platform.operator_session (id, operator_id, expires_at, revoked_at)
    VALUES (gen_random_uuid(), ${operator}::uuid,
            now() + ${over.expiresIn ?? '1 hour'}::interval,
            ${over.revoked === true ? new Date().toISOString() : null})
    RETURNING id`;
  return row?.id ?? '';
}

async function start(body: Record<string, unknown> = {}) {
  return identity.call('POST', START, {
    operatorSessionId: operatorSession,
    tenantId,
    reason: 'Ticket #4821',
    ...body,
  });
}

async function redeem(code: unknown) {
  return identity.call('POST', '/api/internal/handoff/redeem', { code, tenantId });
}

async function audit() {
  return identity.sql<{ operator_id: string; reason: string; session_id: string }[]>`
    SELECT operator_id, reason, session_id FROM platform.support_access
     WHERE tenant_id = ${tenantId}::uuid ORDER BY started_at`;
}

async function supportAccount() {
  const [row] = await identity.sql<{ id: string; identity_id: string; work_email: string }[]>`
    SELECT id, identity_id, work_email FROM platform.account
     WHERE tenant_id = ${tenantId}::uuid AND kind = 'support'`;
  if (!row) throw new Error('no support account');
  return row;
}

describe('starting support', () => {
  it('acts as the operator whose session it is, never as one the body names', async () => {
    const before = (await audit()).length;
    const impostor = '00000000-0000-4000-8000-00000000dead';

    const started = await start({ operatorId: impostor });

    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const rows = await audit();
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)).toMatchObject({ operator_id: operatorId, reason: 'Ticket #4821' });
  });

  it('refuses without a live operator session, and records nothing', async () => {
    const before = (await audit()).length;
    const stale = [
      '00000000-0000-4000-8000-000000000000',
      await sessionFor(operatorId, { revoked: true }),
      await sessionFor(operatorId, { expiresIn: '-1 minute' }),
      'not-a-uuid',
    ];
    for (const operatorSessionId of stale) {
      expect((await start({ operatorSessionId })).status).toBe(401);
    }
    // An operator who is no longer active cannot use a session they still hold.
    const [suspended] = await identity.sql<{ id: string }[]>`
      WITH i AS (INSERT INTO platform.identity (id) VALUES (gen_random_uuid()) RETURNING id)
      INSERT INTO platform.operator (identity_id, email, status)
      SELECT id, 'mallory@kithena.example', 'suspended' FROM i RETURNING id`;
    const held = await sessionFor(suspended?.id ?? '');
    expect((await start({ operatorSessionId: held })).status).toBe(401);

    expect(await audit()).toHaveLength(before);
  });

  it('requires a reason', async () => {
    const refused = await start({ reason: '   ' });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'SUPPORT_REASON_REQUIRED' });
    expect((await start({ reason: 'x'.repeat(501) })).status).toBe(400);
  });

  it('refuses a company that does not exist', async () => {
    expect((await start({ tenantId: '00000000-0000-4000-8000-000000000009' })).status).toBe(404);
  });
});

describe('the handoff code', () => {
  it('is single-use', async () => {
    const { body } = await start();

    const first = await redeem(body['code']);
    expect(first.status).toBe(200);
    expect((await redeem(body['code'])).status).toBe(401);
  });

  it('is short-lived', async () => {
    const { body } = await start();
    await identity.sql`
      UPDATE platform.handoff_code SET expires_at = now() - interval '1 second'
       WHERE redeemed_at IS NULL`;
    expect((await redeem(body['code'])).status).toBe(401);
  });

  it('is good only at the company it was issued for', async () => {
    const { body } = await start();
    const other = await identity.call(
      'POST',
      '/api/internal/admin/tenants',
      companyRequest('globex'),
    );
    const elsewhere = await identity.call('POST', '/api/internal/handoff/redeem', {
      code: body['code'],
      tenantId: other.body['tenantId'],
    });
    expect(elsewhere.status).toBe(401);
  });
});

describe('the support session', () => {
  it('lasts an hour, holds no slot, and names the operator and reason', async () => {
    const { body } = await start({ reason: 'Payroll export stuck' });
    const redeemed = await redeem(body['code']);
    const sessionId = String(redeemed.body['sessionId']);

    const [row] = await identity.sql<
      {
        slot: number | null;
        amr: string[];
        impersonated_by: string;
        reason: string;
        span: string;
      }[]
    >`
      SELECT slot, amr, impersonated_by, reason, (expires_at - started_at)::text AS span
        FROM platform.session WHERE id = ${sessionId}::uuid`;
    expect(row).toEqual({
      slot: null,
      amr: ['support'],
      impersonated_by: operatorId,
      reason: 'Payroll export stuck',
      span: '01:00:00',
    });
    // The cookie is given this, so it expires with the session.
    expect(Date.parse(String(redeemed.body['expiresAt'])) - Date.now()).toBeLessThanOrEqual(
      3600 * 1000,
    );
    expect(body['expiresAt']).toBe(redeemed.body['expiresAt']);
  });

  it('can never be stretched past an hour, by anybody', async () => {
    const { body } = await start();
    const sessionId = String((await redeem(body['code'])).body['sessionId']);

    await expect(identity.sql`
      UPDATE platform.session SET expires_at = started_at + interval '61 minutes'
       WHERE id = ${sessionId}::uuid`).rejects.toThrow(/session_support_shape/);
  });

  it('ends when its hour does', async () => {
    const { body } = await start();
    const sessionId = String((await redeem(body['code'])).body['sessionId']);
    const ask = () => identity.call('POST', '/api/internal/session', { sessionId, tenantId });

    expect((await ask()).status).toBe(200);
    await identity.sql`
      UPDATE platform.session SET expires_at = now() - interval '1 second'
       WHERE id = ${sessionId}::uuid`;
    expect((await ask()).status).toBe(401);
  });

  it('carries the operator as `act` in its access token', async () => {
    const { body } = await start();
    const sessionId = String((await redeem(body['code'])).body['sessionId']);

    const minted = await identity.call('POST', '/api/internal/session/token', {
      sessionId,
      tenantId,
    });
    const claims = decodeJwt(String(minted.body['accessToken']));
    expect(claims['act']).toEqual({ sub: operatorId });
    expect(claims['amr']).toEqual(['support']);
    expect(claims['tid']).toBe(tenantId);
  });

  it('is kept in the audit after the session itself is gone', async () => {
    const { body } = await start({ reason: 'Keep me' });
    const sessionId = String((await redeem(body['code'])).body['sessionId']);

    await identity.call('POST', '/api/internal/session/revoke', { sessionId, tenantId });

    const [gone] = await identity.sql`SELECT 1 FROM platform.session WHERE id = ${sessionId}::uuid`;
    expect(gone).toBeUndefined();
    expect((await audit()).find((r) => r.session_id === sessionId)).toMatchObject({
      reason: 'Keep me',
    });
  });

  it('is announced to the activity log with its reason, in the transaction that records it', async () => {
    const { body } = await start({ reason: 'Ticket 4411' });
    const sessionId = String((await redeem(body['code'])).body['sessionId']);
    const started = await identity.events('identity.support.session_started');
    const row = (await audit()).find((r) => r.session_id === sessionId);
    expect(started.find((p) => p['sessionId'] === sessionId)).toMatchObject({
      operatorId: row?.operator_id,
      reason: 'Ticket 4411',
      accountId: (await supportAccount()).id,
    });
  });

  it('shares one support account between operators, and takes no place from anybody', async () => {
    const [other] = await identity.sql<{ id: string }[]>`
      WITH i AS (INSERT INTO platform.identity (id) VALUES (gen_random_uuid()) RETURNING id)
      INSERT INTO platform.operator (identity_id, email, status)
      SELECT id, 'alan@kithena.example', 'active' FROM i RETURNING id`;
    const theirs = await sessionFor(other?.id ?? '');

    // More at once than any account's slot limit allows.
    const started = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        start({ operatorSessionId: i % 2 === 0 ? operatorSession : theirs }),
      ),
    );
    expect(started.map((s) => s.status)).toEqual(Array(6).fill(201));

    const accounts = await identity.sql`
      SELECT id FROM platform.account WHERE tenant_id = ${tenantId}::uuid AND kind = 'support'`;
    expect(accounts).toHaveLength(1);
  });
});

describe('the support account is nobody', () => {
  it('is never announced to People', async () => {
    const { id } = await supportAccount();
    const provisioned = await identity.events('identity.account.provisioned');
    expect(provisioned.map((p) => p['accountId'])).not.toContain(id);
    const [any] = await identity.sql`
      SELECT 1 FROM platform.outbox WHERE aggregate_id = ${id}`;
    expect(any).toBeUndefined();
  });

  it('is not in the accounts People reconciles from', async () => {
    const { id } = await supportAccount();
    const page = await identity.call('GET', `/api/internal/tenants/${tenantId}/accounts`);
    expect(page.status).toBe(200);
    const listed = (page.body['accounts'] as { accountId: string }[]).map((a) => a.accountId);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed).not.toContain(id);
  });

  it('is not among the company’s people, its counts or its administrator candidates', async () => {
    const { id } = await supportAccount();
    const detail = await identity.call('GET', `/api/internal/admin/tenants/${tenantId}`);
    const people = (detail.body['people'] as { id: string }[]).map((p) => p.id);
    expect(people).not.toContain(id);

    const list = await identity.call('GET', '/api/internal/admin/tenants');
    const acme = (list.body['tenants'] as { id: string; admins: number }[]).find(
      (t) => t.id === tenantId,
    );
    // The one invited administrator, still not active; support adds nobody.
    expect(acme?.admins).toBe(0);

    const named = await identity.call(
      'POST',
      `/api/internal/admin/tenants/${tenantId}/administrators`,
      { entitlement: 'module.people', accountId: id, grant: true, operatorId },
    );
    expect(named.status).not.toBe(201);
  });

  it('cannot be signed into by passkey', async () => {
    const { identity_id } = await supportAccount();
    const offered = await identity.sql`
      SELECT * FROM platform.accounts_for_identity(${identity_id}::uuid)`;
    expect(offered).toHaveLength(0);
  });

  it('can never be given an enrolment or recovery link', async () => {
    const { id, work_email } = await supportAccount();

    await identity.call('POST', '/api/internal/enrolment/recover', {
      tenantId,
      workEmail: work_email,
    });
    const invited = await identity.call(
      'POST',
      `/api/internal/admin/tenants/${tenantId}/invitations`,
      { email: work_email },
    );
    expect(invited.status).not.toBe(201);

    const [link] = await identity.sql`
      SELECT 1 FROM platform.enrolment_token WHERE account_id = ${id}::uuid`;
    expect(link).toBeUndefined();

    // And the database refuses it outright, whoever writes it.
    await expect(identity.sql`
      INSERT INTO platform.enrolment_token
        (tenant_id, account_id, token_hash, expires_at, purpose, second_channel)
      VALUES (${tenantId}::uuid, ${id}::uuid, '\\x00'::bytea, now() + interval '1 hour',
              'recovery', 'known_value')`).rejects.toThrow(/support account/);
  });
});
