import { describe, expect, it } from 'vitest';

import { provisionTenant, type ProvisionTenantDeps } from './provision-tenant.js';

function deps(
  over: Partial<ProvisionTenantDeps> = {},
): ProvisionTenantDeps & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    createTenant: (input) => {
      written.push(`tenant:${input.slug}`);
      return Promise.resolve('00000000-0000-4000-8000-00000000000a');
    },
    inviteAdmin: (_t, email) => {
      written.push(`account:${email}`);
      return Promise.resolve(`acct-${email}`);
    },
    issueEnrolment: (_t, accountId) => {
      written.push(`token:${accountId}`);
      return Promise.resolve(`token-for-${accountId}`);
    },
    inTransaction: (fn) => fn(),
    ...over,
  };
}

const request = {
  slug: 'acme',
  displayName: 'Acme Corp',
  admins: ['ada@acme.example', 'grace@acme.example'],
  accentColor: null,
};

describe('provisionTenant', () => {
  it('creates the company, invites both administrators, and issues a link each', async () => {
    const d = deps();
    const result = await provisionTenant(d)(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.invitations.map((i) => i.email)).toEqual([
      'ada@acme.example',
      'grace@acme.example',
    ]);
    // One link per administrator, and they differ.
    expect(new Set(result.value.invitations.map((i) => i.token)).size).toBe(2);
  });

  it('writes nothing at all when the request is refused', async () => {
    // The rules that need no query run before the transaction opens, so a bad
    // label does not leave a half-built customer behind.
    const d = deps();
    expect((await provisionTenant(d)({ ...request, slug: 'admin' })).ok).toBe(false);
    expect(d.written).toEqual([]);
  });

  it('insists on two administrators before writing anything', async () => {
    const d = deps();
    expect((await provisionTenant(d)({ ...request, admins: ['ada@acme.example'] })).ok).toBe(false);
    expect(d.written).toEqual([]);
  });

  it('does all of it inside one transaction', async () => {
    // Half of this is a company that exists with nobody able to reach it, which
    // looks like a working signup right until somebody tries to log in.
    let inside = false;
    let sawTenantInside = false;
    const d = deps({
      inTransaction: async (fn) => {
        inside = true;
        const value = await fn();
        inside = false;
        return value;
      },
    });
    const spy = deps({
      ...d,
      createTenant: (input) => {
        sawTenantInside = inside;
        return d.createTenant(input);
      },
    });

    await provisionTenant(spy)(request);
    expect(sawTenantInside).toBe(true);
  });

  it('lets a duplicate label fail rather than checking for one first', async () => {
    // Availability is a unique index. Asking the database before writing would
    // be a check-then-act, and two operators creating `acme` at once would both
    // be told it was free.
    const d = deps({ createTenant: () => Promise.reject(new Error('duplicate key')) });
    await expect(provisionTenant(d)(request)).rejects.toThrow('duplicate key');
  });
});
