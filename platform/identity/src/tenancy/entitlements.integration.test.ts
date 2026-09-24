import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { companyRequest, composed, type Composed } from '../testing/composed.js';

/**
 * PEO-114: which modules a company bought, recorded per company by the back
 * office, told to the modules as an event and to the tenant app in the
 * session — with the deployment's list as a default only.
 */

let identity: Composed;

beforeAll(async () => {
  identity = await composed({ defaultEntitlements: ['module.people'] });
});

afterAll(async () => {
  await identity.stop();
});

const tenants = '/api/internal/admin/tenants';

async function create(slug: string, extra: Record<string, unknown> = {}): Promise<string> {
  const created = await identity.call('POST', tenants, companyRequest(slug, extra));
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return String(created.body['tenantId']);
}

describe('a company’s modules', () => {
  it('has the deployment’s list, and raises nothing, until one is recorded', async () => {
    const id = await create('defaulted');
    const detail = await identity.call('GET', `${tenants}/${id}`);
    expect(detail.body).toMatchObject({
      entitlements: null,
      effectiveEntitlements: ['module.people'],
    });
    const raised = await identity.sql`
      SELECT 1 FROM platform.outbox
       WHERE tenant_id = ${id}::uuid AND event_name = 'identity.tenant.entitlements_changed'`;
    expect(raised).toHaveLength(0);
  });

  it('records the wizard’s choice and announces it with the company', async () => {
    const id = await create('chosen', { entitlements: ['module.timeoff'] });
    const detail = await identity.call('GET', `${tenants}/${id}`);
    expect(detail.body).toMatchObject({
      entitlements: ['module.timeoff'],
      effectiveEntitlements: ['module.timeoff'],
    });
    const [announced] = await identity.sql<{ payload: unknown }[]>`
      SELECT envelope -> 'payload' AS payload FROM platform.outbox
       WHERE tenant_id = ${id}::uuid AND event_name = 'identity.tenant.entitlements_changed'`;
    expect(announced?.payload).toEqual({ entitlements: ['module.timeoff'] });
  });

  it('changes on the company page, once per real change', async () => {
    const id = await create('changing');
    const put = (entitlements: unknown) =>
      identity.call('PUT', `${tenants}/${id}/entitlements`, { entitlements });

    expect((await put(['module.timeoff', 'module.people'])).body).toMatchObject({
      entitlements: ['module.people', 'module.timeoff'],
    });
    await put(['module.people', 'module.timeoff']);
    // Bought nothing is an answer, and not the same as no answer.
    expect((await put([])).body).toMatchObject({ entitlements: [], effectiveEntitlements: [] });

    const raised = await identity.sql<{ payload: { entitlements: string[] } }[]>`
      SELECT envelope -> 'payload' AS payload FROM platform.outbox
       WHERE tenant_id = ${id}::uuid AND event_name = 'identity.tenant.entitlements_changed'
       ORDER BY created_at, event_id`;
    expect(raised.map((r) => r.payload.entitlements)).toEqual([
      ['module.people', 'module.timeoff'],
      [],
    ]);
  });

  it('refuses a module that does not exist, and a company that does not', async () => {
    const id = await create('refusing');
    const unknown = await identity.call('PUT', `${tenants}/${id}/entitlements`, {
      entitlements: ['module.crypto'],
    });
    expect(unknown.status).toBe(422);
    const missing = await identity.call(
      'PUT',
      `${tenants}/00000000-0000-4000-8000-00000000dead/entitlements`,
      { entitlements: [] },
    );
    expect(missing.status).toBe(404);
  });

  it('is refused by the database when a path skips the application', async () => {
    const id = await create('guarded');
    await expect(
      identity.sql`UPDATE platform.tenant SET entitlements = ARRAY['module.people','module.people']
                    WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/tenant_entitlements_shape/);
    await expect(
      identity.sql`UPDATE platform.tenant SET entitlements = ARRAY['People']
                    WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/tenant_entitlements_shape/);
  });
});
