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
    // An administrator holds HR's and finance's rights too (decided 2026-09-29).
    expect(routed.ok && [...routed.value.viewer.roles].toSorted()).toEqual([
      'finance',
      'hr',
      'people_admin',
    ]);
    expect(asked).toEqual([
      '00000000-0000-4000-8000-000000000001 00000000-0000-4000-8000-0000000000b1',
    ]);

    // Refused before OpenFGA is asked anything.
    const forged = await withRoles({ headers: { 'x-kithena-principal': principal() } });
    expect(forged.ok).toBe(false);
    expect(asked).toHaveLength(1);
  });
});

describe('an administrator’s roles (decided 2026-09-29)', () => {
  const routed = (roles: string[]) =>
    callerFrom({
      headers: {
        'x-internal-token': 'router-secret',
        'x-kithena-principal': principal({ roles }),
      },
    });

  it('include HR’s and finance’s, standalone as with OpenFGA', () => {
    const admin = routed(['people_admin']);
    expect(admin.ok && [...admin.value.viewer.roles].toSorted()).toEqual([
      'finance',
      'hr',
      'people_admin',
    ]);
  });

  it('are not given to HR or finance', () => {
    const hr = routed(['hr']);
    expect(hr.ok && [...hr.value.viewer.roles]).toEqual(['hr']);
    const finance = routed(['finance']);
    expect(finance.ok && [...finance.value.viewer.roles]).toEqual(['finance']);
  });

  it('with OpenFGA, are whatever it answers for HR or finance, and no more', async () => {
    const withRoles = withTenantRoles(callerFrom, () => Promise.resolve(new Set(['hr'])));
    const hr = await withRoles({
      headers: { 'x-internal-token': 'router-secret', 'x-kithena-principal': principal() },
    });
    expect(hr.ok && [...hr.value.viewer.roles]).toEqual(['hr']);
  });
});

describe('Kithena support (decided 2026-09-29)', () => {
  const OPERATOR = '00000000-0000-4000-8000-0000000000c1';
  const routed = (over: Record<string, unknown>) => ({
    headers: { 'x-internal-token': 'router-secret', 'x-kithena-principal': principal(over) },
  });

  it('is a principal the router forwards with impersonatedBy: a full administrator', () => {
    const support = callerFrom(
      routed({ roles: [], impersonatedBy: OPERATOR, impersonationReason: ' Ticket 4812 ' }),
    );
    expect(support.ok && support.value.viewer.support).toEqual({
      operatorId: OPERATOR,
      reason: 'Ticket 4812',
    });
    expect(support.ok && [...support.value.viewer.roles].toSorted()).toEqual([
      'finance',
      'hr',
      'people_admin',
    ]);
  });

  it('keeps its reason optional: the operator is always recorded, the reason when forwarded', () => {
    const support = callerFrom(routed({ impersonatedBy: OPERATOR }));
    expect(support.ok && support.value.viewer.support).toEqual({
      operatorId: OPERATOR,
      reason: null,
    });
  });

  it('is nobody else: no impersonatedBy, or null, is an ordinary caller', () => {
    for (const over of [{}, { impersonatedBy: null }]) {
      const plain = callerFrom(routed({ ...over, roles: [] }));
      expect(plain.ok && plain.value.viewer.support).toBeUndefined();
      expect(plain.ok && plain.value.viewer.roles.size).toBe(0);
    }
  });

  it('is refused when impersonatedBy is not an account, or the reason is too long', () => {
    for (const over of [
      { impersonatedBy: 'root' },
      { impersonatedBy: OPERATOR, impersonationReason: 'x'.repeat(501) },
    ]) {
      const refused = callerFrom(routed(over));
      expect(!refused.ok && refused.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('is never claimed without the internal token', () => {
    const forged = callerFrom({
      headers: { 'x-kithena-principal': principal({ impersonatedBy: OPERATOR }) },
    });
    expect(!forged.ok && forged.error.code).toBe('UNAUTHENTICATED');
  });

  it('keeps its roles with OpenFGA, which holds no tuple for it and is not asked', async () => {
    let asked = false;
    const withRoles = withTenantRoles(callerFrom, () => {
      asked = true;
      return Promise.resolve(new Set<string>());
    });
    const support = await withRoles(routed({ impersonatedBy: OPERATOR }));
    expect(support.ok && [...support.value.viewer.roles].toSorted()).toEqual([
      'finance',
      'hr',
      'people_admin',
    ]);
    expect(asked).toBe(false);
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
