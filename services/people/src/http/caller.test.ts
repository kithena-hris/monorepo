import { describe, expect, it } from 'vitest';

import { callerFromHeaders } from './caller.js';

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
});
