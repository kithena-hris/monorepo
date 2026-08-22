import { describe, expect, it } from 'vitest';

import type { Tenant } from '../domain/tenant.js';
import { resolveTenant } from './resolve-tenant.js';
import type { TenantRepository } from './tenant-repository.js';

const acme: Tenant = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'acme',
  status: 'active',
  branding: { displayName: null, logoUrl: null, accentColor: null },
};

/** A repository that knows two tenants and nothing else. */
function fakeRepository(tenants: readonly Tenant[]): TenantRepository & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    bySlug: (slug) => {
      calls.push(slug);
      return Promise.resolve(tenants.find((t) => t.slug === slug) ?? null);
    },
  };
}

describe('resolveTenant', () => {
  it('resolves an active tenant', async () => {
    const resolve = resolveTenant({ tenants: fakeRepository([acme]) });

    const result = await resolve('acme');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(acme.id);
  });

  it('refuses a slug it has never heard of', async () => {
    const resolve = resolveTenant({ tenants: fakeRepository([acme]) });

    const result = await resolve('globex');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.path).toEqual(['unknown']);
  });

  it('refuses a suspended tenant as firmly as an unknown one', async () => {
    const resolve = resolveTenant({
      tenants: fakeRepository([{ ...acme, slug: 'lapsed', status: 'suspended' }]),
    });

    const result = await resolve('lapsed');

    expect(result.ok).toBe(false);
  });

  it('spends no query on a label that cannot be in the registry', async () => {
    // Not an optimisation. Without this, anyone can make the database answer a
    // question for every string they can think of, which is a free amplifier
    // pointed at the one table read before a tenant is known.
    const repository = fakeRepository([acme]);
    const resolve = resolveTenant({ tenants: repository });

    const results = await Promise.all(
      ['auth', 'admin', '-acme', 'xn--pple-43d', 'ACME'].map((slug) => resolve(slug)),
    );

    expect(results.map((r) => r.ok)).toEqual([false, false, false, false, false]);
    expect(repository.calls).toEqual([]);
  });

  it('propagates a repository failure rather than treating it as "no tenant"', async () => {
    // A database that is down must not look like a customer who does not
    // exist. Serving 404s during an outage trains everyone to ignore them, and
    // a caller retrying a 404 is a caller that never retries.
    const resolve = resolveTenant({
      tenants: { bySlug: () => Promise.reject(new Error('connection refused')) },
    });

    await expect(resolve('acme')).rejects.toThrow('connection refused');
  });

  it('asks the repository for exactly the slug it was given', async () => {
    const repository = fakeRepository([acme]);
    const resolve = resolveTenant({ tenants: repository });

    await resolve('acme');

    expect(repository.calls).toEqual(['acme']);
  });
});

describe('the fake itself behaves', () => {
  it('returns null rather than throwing for an absent tenant', async () => {
    // A negative control. If the fake threw, the "unknown" test above would
    // pass for the wrong reason.
    const repository = fakeRepository([]);
    await expect(repository.bySlug('nobody')).resolves.toBeNull();
    expect(repository.calls).toEqual(['nobody']);
  });
});
