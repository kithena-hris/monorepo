import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import { companyRequest, composed, type Composed } from '../testing/composed.js';

/**
 * PEO-113: identity issues the tenant app's server an access token for the
 * signed-in session — the token the Cosmo Router verifies against this
 * service's JWKS — and nothing else gets one.
 */

let identity: Composed;
let tenantId = '';
let accountId = '';
const AUDIENCE = 'kithena-router';

beforeAll(async () => {
  identity = await composed({ defaultEntitlements: [], tokenIssuer: 'https://auth.test' });
  const created = await identity.call(
    'POST',
    '/api/internal/admin/tenants',
    companyRequest('tokens', {
      entitlements: ['module.people'],
      administrators: { 'module.people': 'ada@tokens.example' },
    }),
  );
  tenantId = String(created.body['tenantId']);
  const [row] = await identity.sql<{ id: string }[]>`
    SELECT id FROM platform.account WHERE tenant_id = ${tenantId}::uuid`;
  accountId = row?.id ?? '';
});

afterAll(async () => {
  await identity.stop();
});

let slot = 0;
async function session(): Promise<string> {
  const id = randomUUID();
  slot += 1;
  await identity.sql`
    INSERT INTO platform.session (id, tenant_id, account_id, slot, expires_at, amr)
    VALUES (${id}::uuid, ${tenantId}::uuid, ${accountId}::uuid, ${slot}, now() + interval '1 day',
            ARRAY['hwk'])`;
  return id;
}

describe('an access token for the router', () => {
  it('is issued for a live session, verifiable against the published JWKS', async () => {
    const issued = await identity.call('POST', '/api/internal/session/token', {
      sessionId: await session(),
      tenantId,
    });
    expect(issued.status).toBe(200);
    expect(issued.body['tokenType']).toBe('Bearer');

    const { payload, protectedHeader } = await jwtVerify(
      String(issued.body['accessToken']),
      createRemoteJWKSet(new URL(`${identity.url}/.well-known/jwks.json`)),
      { issuer: 'https://auth.test', audience: AUDIENCE },
    );
    expect(protectedHeader.alg).toBe('ES256');
    expect(payload).toMatchObject({
      sub: accountId,
      tid: tenantId,
      amr: ['hwk'],
      ent: ['module.people'],
    });
    // Minutes, not the session's thirty days.
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(300);
    expect(Date.parse(String(issued.body['expiresAt']))).toBeGreaterThan(Date.now());
  });

  it('is refused for a session that does not exist, or on another company', async () => {
    const unknown = await identity.call('POST', '/api/internal/session/token', {
      sessionId: randomUUID(),
      tenantId,
    });
    expect(unknown.status).toBe(401);
    const elsewhere = await identity.call('POST', '/api/internal/session/token', {
      sessionId: await session(),
      tenantId: randomUUID(),
    });
    expect(elsewhere.status).toBe(401);
  });

  it('is never handed to a caller without the internal token', async () => {
    const response = await fetch(`${identity.url}/api/internal/session/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: await session(), tenantId }),
    });
    expect(response.status).toBe(401);
  });
});
