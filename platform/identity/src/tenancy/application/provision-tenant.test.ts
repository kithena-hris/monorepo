import { describe, expect, it } from 'vitest';

import {
  provisionTenant,
  type ProvisionScope,
  type ProvisionTenantDeps,
} from './provision-tenant.js';
import type { Invitation } from './invitation-notifier.js';

/**
 * A scope whose four writes append to one list, so a test can assert *order*
 * as well as content. Order is the thing that broke: `enterTenant` after the
 * first account insert is a 42501, and nothing about the individual calls says
 * so.
 */
function scope(written: string[], over: Partial<ProvisionScope> = {}): ProvisionScope {
  return {
    createTenant: (input) => {
      written.push(`tenant:${input.slug}`);
      return Promise.resolve('00000000-0000-4000-8000-00000000000a');
    },
    enterTenant: (tenantId) => {
      written.push(`enter:${tenantId}`);
      return Promise.resolve();
    },
    inviteAdmin: (_t, email) => {
      written.push(`account:${email}`);
      return Promise.resolve({
        accountId: `acct-${email}`,
        identityId: `id-${email}`,
        token: `token-for-acct-${email}`,
        expiresAt: EXPIRES,
      });
    },
    ...over,
  };
}

/** The deadline the database would return. Fixed, so the message is assertable. */
const EXPIRES = '2026-08-27T09:05:00.000Z';

const AUTH_ORIGIN = 'https://auth.app.kithena.com';

function deps(
  over: Partial<ProvisionScope> = {},
  extra: Partial<ProvisionTenantDeps> = {},
): ProvisionTenantDeps & { written: string[]; announced: Invitation[] } {
  const written: string[] = [];
  const announced: Invitation[] = [];

  return {
    written,
    announced,
    authOrigin: AUTH_ORIGIN,
    notifier: {
      send: (invitation) => {
        announced.push(invitation);
        return Promise.resolve({ delivered: true, messageId: 'msg_1', reason: null });
      },
    },
    inTransaction: (fn) => fn(scope(written, over)),
    ...extra,
  };
}

const request = {
  slug: 'acme',
  displayName: 'Acme Corp',
  admins: ['ada@acme.example', 'grace@acme.example'],
  themeId: 'indigo',
  logoUrl: null,
  coverImageUrl: null,
  address: {
    country: 'ES',
    line1: 'Calle de Alcalá 45',
    line2: null,
    city: 'Madrid',
    subdivision: '28',
    postcode: '28013',
  },
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

  it('insists on an administrator before writing anything', async () => {
    // One is enough since 2026-08-22; none never was. A company nobody can sign
    // in to is not a company, and it would look like a successful signup.
    const d = deps();
    expect((await provisionTenant(d)({ ...request, admins: [] })).ok).toBe(false);
    expect(d.written).toEqual([]);
  });

  it('creates a company with a single administrator', async () => {
    const d = deps();
    const result = await provisionTenant(d)({ ...request, admins: ['ada@acme.example'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.invitations).toHaveLength(1);
  });

  it('does all of it inside one transaction', async () => {
    // Half of this is a company that exists with nobody able to reach it, which
    // looks like a working signup right until somebody tries to log in.
    //
    // Every write now comes from the scope the transaction hands out, so
    // "inside" is structural rather than something a test has to catch a
    // closure doing. What is asserted is that nothing was written after it
    // closed — which is what a leaked pool connection would show as.
    const written: string[] = [];
    let open = false;
    let escaped = false;

    await provisionTenant({
      authOrigin: AUTH_ORIGIN,
      inTransaction: async (fn) => {
        open = true;
        const value = await fn(
          scope(written, {
            createTenant: (input) => {
              if (!open) escaped = true;
              written.push(`tenant:${input.slug}`);
              return Promise.resolve('00000000-0000-4000-8000-00000000000a');
            },
          }),
        );
        open = false;
        return value;
      },
    })(request);

    expect(escaped).toBe(false);
    expect(written[0]).toBe('tenant:acme');
  });

  it('lets a duplicate label fail rather than checking for one first', async () => {
    // Availability is a unique index. Asking the database before writing would
    // be a check-then-act, and two operators creating `acme` at once would both
    // be told it was free.
    const d = deps({ createTenant: () => Promise.reject(new Error('duplicate key')) });
    await expect(provisionTenant(d)(request)).rejects.toThrow('duplicate key');
  });
});

describe('telling the administrators', () => {
  it('sends one message per administrator, with a link the enrolment page reads', async () => {
    const d = deps();
    const result = await provisionTenant(d)(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(d.announced.map((i) => i.email)).toEqual(['ada@acme.example', 'grace@acme.example']);

    const link = new URL(d.announced[0]?.enrolUrl ?? '');
    expect(link.origin).toBe(AUTH_ORIGIN);
    expect(link.pathname).toBe('/enrol');
    expect(link.searchParams.get('tenant')).toBe('acme');
    // The half of the brief that is not the email: the page names the account
    // before the device prompt appears.
    expect(link.searchParams.get('name')).toBe('ada@acme.example');
    expect(link.searchParams.get('token')).toBe('token-for-acct-ada@acme.example');
  });

  it('states the deadline the database set, not one it recomputed', async () => {
    const d = deps();
    await provisionTenant(d)(request);
    expect(d.announced[0]?.expiresAt).toBe(EXPIRES);
  });

  it('sends nothing until the transaction has committed', async () => {
    // An email cannot be rolled back, so a send inside the transaction would be
    // claiming a guarantee that does not exist — and it would hold a Postgres
    // connection open across a call to a third party while doing it.
    const order: string[] = [];
    const announced: Invitation[] = [];

    const result = await provisionTenant({
      authOrigin: AUTH_ORIGIN,
      notifier: {
        send: (invitation) => {
          announced.push(invitation);
          order.push('send');
          return Promise.resolve({ delivered: true, messageId: null, reason: null });
        },
      },
      inTransaction: async (fn) => {
        const value = await fn(scope([]));
        order.push('commit');
        return value;
      },
    })(request);

    expect(result.ok).toBe(true);
    expect(order).toEqual(['commit', 'send', 'send']);
    expect(announced).toHaveLength(2);
  });

  it('still hands back the links when nothing could be sent', async () => {
    // A messaging outage must not fail the creation of a customer. The company
    // exists, the tokens are live, and the operator becomes the channel — which
    // is the channel docs/authentication.md prefers anyway.
    const d = deps({}, { notifier: undefined });
    const result = await provisionTenant(d)(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const invitation of result.value.invitations) {
      expect(invitation.delivery.delivered).toBe(false);
      expect(invitation.delivery.reason).toBe('no_messaging_service');
      expect(invitation.enrolUrl).toContain('/enrol?');
      // And the token is still shown once, which is what the back-office reads.
      expect(invitation.token).toBe(`token-for-acct-${invitation.email}`);
    }
  });
});

describe('row-level security during provisioning', () => {
  it('enters the tenant before writing anything scoped to it', async () => {
    // `platform.account` carries RLS with FORCE, so an insert with no
    // `app.tenant_id` set is refused with 42501 — which is what happened, and
    // it surfaced as a 500 on the one path that matters. The order is the
    // assertion: the tenant has to exist before its id can be entered, and the
    // context has to be set before the first account is written.
    const d = deps();
    const result = await provisionTenant(d)(request);
    expect(result.ok).toBe(true);

    const tenant = d.written.indexOf('tenant:acme');
    const enter = d.written.indexOf('enter:00000000-0000-4000-8000-00000000000a');
    const firstAccount = d.written.findIndex((w) => w.startsWith('account:'));

    expect(tenant).toBeGreaterThanOrEqual(0);
    expect(enter).toBeGreaterThan(tenant);
    expect(firstAccount).toBeGreaterThan(enter);
  });

  it('does not enter a tenant it refused to create', async () => {
    const d = deps();
    await provisionTenant(d)({ ...request, admins: [] });
    expect(d.written).toEqual([]);
  });
});
