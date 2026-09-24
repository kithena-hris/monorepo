import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { companyRequest, composed, type Composed } from '../testing/composed.js';

/**
 * PEO-112: the back office is the only way anybody first administers People.
 * Switching People on names an existing account, at creation or afterwards,
 * and `identity.tenant.administrator_named` carries it to the module.
 */

let identity: Composed;
const OPERATOR = '00000000-0000-4000-8000-0000000000f1';
const tenants = '/api/internal/admin/tenants';

beforeAll(async () => {
  identity = await composed({ defaultEntitlements: [] });
});

afterAll(async () => {
  // Missing when `beforeAll` failed, which is then the only error worth reading.
  await (identity as Composed | undefined)?.stop();
});

async function named(tenantId: string) {
  return identity.sql<{ payload: Record<string, unknown> }[]>`
    SELECT envelope -> 'payload' AS payload FROM platform.outbox
     WHERE tenant_id = ${tenantId}::uuid AND event_name = 'identity.tenant.administrator_named'
     ORDER BY created_at, event_id`;
}

async function accountOf(tenantId: string, email: string): Promise<string> {
  const [row] = await identity.sql<{ id: string }[]>`
    SELECT id FROM platform.account WHERE tenant_id = ${tenantId}::uuid AND work_email = ${email}`;
  return row?.id ?? '';
}

describe('naming who administers People', () => {
  it('names one of the invited administrators when the company is created with People', async () => {
    const created = await identity.call(
      'POST',
      tenants,
      companyRequest('founding', {
        admins: ['ada@founding.example', 'grace@founding.example'],
        entitlements: ['module.people'],
        administrators: { 'module.people': 'grace@founding.example' },
        operatorId: OPERATOR,
      }),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = String(created.body['tenantId']);
    expect((await named(id)).map((r) => r.payload)).toEqual([
      {
        entitlement: 'module.people',
        accountId: await accountOf(id, 'grace@founding.example'),
        namedBy: OPERATOR,
      },
    ]);
  });

  it('refuses to create a company with People and nobody to administer it', async () => {
    const refused = await identity.call(
      'POST',
      tenants,
      companyRequest('headless', { entitlements: ['module.people'] }),
    );
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'ADMINISTRATOR_REQUIRED' });
    const [row] = await identity.sql`SELECT 1 FROM platform.tenant WHERE slug = 'headless'`;
    expect(row).toBeUndefined();
  });

  it('switches People on later only with an existing account named, then on request', async () => {
    const created = await identity.call('POST', tenants, companyRequest('later'));
    const id = String(created.body['tenantId']);
    const ada = await accountOf(id, 'ada@later.example');
    const put = (body: Record<string, unknown>) =>
      identity.call('PUT', `${tenants}/${id}/entitlements`, body);

    expect((await put({ entitlements: ['module.people'] })).body).toMatchObject({
      code: 'ADMINISTRATOR_REQUIRED',
    });
    expect(
      (
        await put({
          entitlements: ['module.people'],
          administrators: { 'module.people': '00000000-0000-4000-8000-00000000dead' },
        })
      ).body,
    ).toMatchObject({ code: 'ADMINISTRATOR_UNUSABLE' });
    expect((await identity.call('GET', `${tenants}/${id}`)).body).toMatchObject({
      entitlements: null,
    });

    const on = await put({
      entitlements: ['module.people'],
      administrators: { 'module.people': ada },
      operatorId: OPERATOR,
    });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ entitlements: ['module.people'] });

    // Afterwards, for a company that lost its administrators.
    const again = await identity.call('POST', `${tenants}/${id}/administrators`, {
      entitlement: 'module.people',
      accountId: ada,
    });
    expect(again.status).toBe(201);
    expect((await named(id)).map((r) => r.payload['namedBy'])).toEqual([OPERATOR, null]);
  });

  it('names nobody for a module the company does not have', async () => {
    const created = await identity.call('POST', tenants, companyRequest('without'));
    const id = String(created.body['tenantId']);
    const refused = await identity.call('POST', `${tenants}/${id}/administrators`, {
      entitlement: 'module.people',
      accountId: await accountOf(id, 'ada@without.example'),
    });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'MODULE_NOT_ENABLED' });
  });
});
