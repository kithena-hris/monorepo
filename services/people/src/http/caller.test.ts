import { describe, expect, it } from 'vitest';

import { callerFromHeaders, callerWithEntitlements, withTenantRoles } from './caller.js';

const callerFrom = callerFromHeaders('router-secret');
const principal = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    userId: '00000000-0000-4000-8000-0000000000b1',
    tenantId: '00000000-0000-4000-8000-000000000001',
    roles: ['hr'],
    entitlements: ['module.people'],
    ...over,
  });

describe('who is calling', () => {
  it('trusts forwarded claims only alongside the internal token', () => {
    const forged = callerFrom({ headers: { 'x-kithena-principal': principal() } });
    expect(!forged.ok && forged.error.code).toBe('UNAUTHENTICATED');

    const routed = callerFrom({
      headers: { 'x-internal-token': 'router-secret', 'x-kithena-principal': principal() },
    });
    expect(routed.ok && routed.value.viewer.roles.has('hr')).toBe(true);
  });

  it('refuses a workspace that did not buy People', () => {
    const result = callerFrom({
      headers: {
        'x-internal-token': 'router-secret',
        'x-kithena-principal': principal({ entitlements: [] }),
      },
    });
    expect(!result.ok && result.error.code).toBe('NOT_ENTITLED');
  });

  it('refuses a principal that is not JSON, or not a principal', () => {
    for (const value of ['{nope', JSON.stringify({ userId: 'x' })]) {
      const result = callerFrom({
        headers: { 'x-internal-token': 'router-secret', 'x-kithena-principal': value },
      });
      expect(!result.ok && result.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('refuses everything when no token is configured', () => {
    const open = callerFromHeaders('')({
      headers: { 'x-internal-token': '', 'x-kithena-principal': principal() },
    });
    expect(open.ok).toBe(false);
  });

  it('takes tenant roles from OpenFGA, never from the header, when OpenFGA decides (PEO-092)', async () => {
    const asked: string[] = [];
    const withRoles = withTenantRoles(callerFrom, (tenantId, accountId) => {
      asked.push(`${tenantId} ${accountId}`);
      return Promise.resolve(new Set(['people_admin']));
    });
    const routed = await withRoles({
      headers: { 'x-internal-token': 'router-secret', 'x-kithena-principal': principal() },
    });
    expect(routed.ok && [...routed.value.viewer.roles]).toEqual(['people_admin']);
    expect(asked).toEqual([
      '00000000-0000-4000-8000-000000000001 00000000-0000-4000-8000-0000000000b1',
    ]);

    // Refused before OpenFGA is asked anything.
    const forged = await withRoles({ headers: { 'x-kithena-principal': principal() } });
    expect(forged.ok).toBe(false);
    expect(asked).toHaveLength(1);
  });
});

describe('what the company bought (PEO-114)', () => {
  const routed = (over: Record<string, unknown> = {}) => ({
    headers: { 'x-internal-token': 'router-secret', 'x-kithena-principal': principal(over) },
  });

  it('takes the recorded list over the forwarded one, both ways', async () => {
    const dropped = callerWithEntitlements('router-secret', () => Promise.resolve([]));
    const refused = await dropped(routed());
    expect(!refused.ok && refused.error.code).toBe('NOT_ENTITLED');

    const bought = callerWithEntitlements('router-secret', () =>
      Promise.resolve(['module.people']),
    );
    expect((await bought(routed({ entitlements: [] }))).ok).toBe(true);
  });

  it('uses the forwarded list, the deployment default, when nothing is recorded', async () => {
    const unrecorded = callerWithEntitlements('router-secret', () => Promise.resolve(null));
    expect((await unrecorded(routed())).ok).toBe(true);
    const none = await unrecorded(routed({ entitlements: [] }));
    expect(!none.ok && none.error.code).toBe('NOT_ENTITLED');
  });

  it('looks nothing up for a caller that is not the router', async () => {
    let looked = false;
    const caller = callerWithEntitlements('router-secret', () => {
      looked = true;
      return Promise.resolve(['module.people']);
    });
    const forged = await caller({ headers: { 'x-kithena-principal': principal() } });
    expect(!forged.ok && forged.error.code).toBe('UNAUTHENTICATED');
    expect(looked).toBe(false);
  });
});
