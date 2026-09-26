import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { adminRoutes, type TenantDetail } from './admin-routes.js';

/**
 * What the back-office actually gets back when it asks for one company.
 *
 * This file exists because the detail route had no test at all and the
 * back-office reported every failure as "this page could not be found" — a page
 * that is missing, a service that is refusing, and a path the router does not
 * recognise were indistinguishable from the outside. The first three cases
 * below are exactly that distinction, at the only place it can be established.
 */

const TOKEN = 'dev-only-key';
const ID = '0199a3cd-1f1a-7c9c-9b41-1f2f2b6c47d1';

function detailOf(overrides: Partial<TenantDetail> = {}): TenantDetail {
  return {
    id: ID,
    slug: 'acme',
    displayName: 'Acme',
    status: 'active',
    createdAt: '2026-09-01T00:00:00.000Z',
    themeId: null,
    logoUrl: null,
    coverImageUrl: null,
    brandingPublic: true,
    address: null,
    people: [],
    entitlements: null,
    effectiveEntitlements: [],
    administrators: {},
    ...overrides,
  };
}

/** Enough of a response to see what a route decided. */
function fakeResponse(): {
  response: ServerResponse;
  status: () => number | undefined;
  body: () => unknown;
} {
  let status: number | undefined;
  let payload: string | undefined;

  const response = {
    writeHead(code: number) {
      status = code;
      return this;
    },
    end(chunk?: string) {
      if (typeof chunk === 'string') payload = chunk;
      return this;
    },
  } as unknown as ServerResponse;

  return {
    response,
    status: () => status,
    body: (): unknown => (payload === undefined ? undefined : (JSON.parse(payload) as unknown)),
  };
}

/** `null` means the caller presented no token at all — not `undefined`, which
 *  a default parameter would quietly replace with the real one. */
function request(url: string, token: string | null = TOKEN): IncomingMessage {
  return {
    url,
    method: 'GET',
    headers: token === null ? {} : { 'x-internal-token': token },
  } as unknown as IncomingMessage;
}

function routes(
  tenantDetail: (id: string) => Promise<TenantDetail | null>,
  over: Partial<Parameters<typeof adminRoutes>[0]> = {},
) {
  return adminRoutes({
    internalToken: TOKEN,
    listTenants: () => Promise.resolve({ tenants: [], nextCursor: null }),
    tenantDetail,
    // None of these are reached by a GET on the detail path, and a test that
    // supplied working versions would be asserting the wiring rather than the
    // route.
    withdrawInvitation: vi.fn() as never,
    provision: vi.fn() as never,
    amend: vi.fn() as never,
    invite: vi.fn() as never,
    setEntitlements: vi.fn() as never,
    nameAdministrator: vi.fn() as never,
    ...over,
  });
}

/** A PUT with a JSON body, readable the way `readJsonBody` reads one. */
function put(url: string, body: unknown): IncomingMessage {
  const chunks = [Buffer.from(JSON.stringify(body))];
  return {
    url,
    method: 'PUT',
    headers: { 'x-internal-token': TOKEN },
    [Symbol.asyncIterator]: () => chunks.values(),
  } as unknown as IncomingMessage;
}

describe('recording the modules a company bought (PEO-114)', () => {
  const path = `/api/internal/admin/tenants/${ID}/entitlements`;

  it('records the list and answers with the company as stored', async () => {
    const setEntitlements = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          entitlements: ['module.people' as const],
          changed: true,
          named: [],
          removed: [],
        },
      }),
    );
    const { response, status, body } = fakeResponse();
    await routes(
      () =>
        Promise.resolve(
          detailOf({ entitlements: ['module.people'], effectiveEntitlements: ['module.people'] }),
        ),
      { setEntitlements },
    )(put(path, { entitlements: ['module.people'] }), response);

    expect(setEntitlements).toHaveBeenCalledWith(ID, {
      entitlements: ['module.people'],
      administrators: {},
      namedBy: null,
    });
    expect(status()).toBe(200);
    expect(body()).toMatchObject({ entitlements: ['module.people'] });
  });

  it('passes on each module’s administrators, as a list or the older single id', async () => {
    const setEntitlements = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: { entitlements: [], changed: false, named: [], removed: [] },
      }),
    );
    const { response } = fakeResponse();
    await routes(() => Promise.resolve(detailOf()), { setEntitlements })(
      put(path, {
        entitlements: ['module.people', 'module.timeoff'],
        administrators: {
          'module.people': ['a', 'b'],
          'module.timeoff': 'c',
          'module.nope': [1],
        },
        operatorId: '00000000-0000-4000-8000-0000000000f1',
      }),
      response,
    );
    expect(setEntitlements).toHaveBeenCalledWith(ID, {
      entitlements: ['module.people', 'module.timeoff'],
      administrators: { 'module.people': ['a', 'b'], 'module.timeoff': 'c' },
      namedBy: '00000000-0000-4000-8000-0000000000f1',
    });
  });

  it('refuses a body that is not a list of strings', async () => {
    const { response, status } = fakeResponse();
    await routes(() => Promise.resolve(detailOf()))(put(path, { entitlements: 'module.people' }), response);
    expect(status()).toBe(400);
  });

  it('passes on the domain refusal with its code', async () => {
    const setEntitlements = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'ENTITLEMENT_UNKNOWN', message: 'no', path: ['entitlements'] },
      }),
    );
    const { response, status, body } = fakeResponse();
    await routes(() => Promise.resolve(detailOf()), { setEntitlements })(
      put(path, { entitlements: ['module.nope'] }),
      response,
    );
    expect(status()).toBe(422);
    expect(body()).toMatchObject({ code: 'ENTITLEMENT_UNKNOWN' });
  });
});

describe('the company detail route', () => {
  it('answers 200 with the company when it exists', async () => {
    const { response, status, body } = fakeResponse();
    const handled = await routes(() => Promise.resolve(detailOf()))(
      request(`/api/internal/admin/tenants/${ID}`),
      response,
    );

    expect(handled).toBe(true);
    expect(status()).toBe(200);
    expect(body()).toMatchObject({ id: ID, displayName: 'Acme', brandingPublic: true });
  });

  it('answers 404 only when the company is genuinely not there', async () => {
    const { response, status } = fakeResponse();
    await routes(() => Promise.resolve(null))(request(`/api/internal/admin/tenants/${ID}`), response);

    expect(status()).toBe(404);
  });

  it('lets a failure be a failure rather than reporting it as missing', async () => {
    // What a permission error or a dropped connection looks like from here. The
    // route must not turn it into a 404: the caller renders that as "no such
    // company", and an operator then goes looking for a deletion that never
    // happened.
    const { response } = fakeResponse();
    await expect(
      routes(() => {
        throw new Error('permission denied for table account');
      })(request(`/api/internal/admin/tenants/${ID}`), response),
    ).rejects.toThrow('permission denied');
  });

  it('refuses a caller with no token before it reads anything', async () => {
    const tenantDetail = vi.fn(() => Promise.resolve(detailOf()));
    const { response, status } = fakeResponse();
    await routes(tenantDetail)(request(`/api/internal/admin/tenants/${ID}`, null), response);

    expect(status()).toBe(401);
    expect(tenantDetail).not.toHaveBeenCalled();
  });

  it('does not claim a path that only starts like the route', async () => {
    // `return false` means "not mine", and the server 404s it. The distinction
    // matters: a route that claimed this would answer 401 to anything under
    // `/api/internal/admin/tenants/…`, including paths it cannot serve.
    const { response } = fakeResponse();
    const handled = await routes(() => Promise.resolve(detailOf()))(
      request('/api/internal/admin/tenants/not-a-uuid'),
      response,
    );

    expect(handled).toBe(false);
  });

  it('matches the id whatever case it arrives in, and ignores the query string', async () => {
    const seen: string[] = [];
    const { response, status } = fakeResponse();
    await routes((id) => {
      seen.push(id);
      return Promise.resolve(detailOf());
    })(request(`/api/internal/admin/tenants/${ID.toUpperCase()}?created=1`), response);

    expect(status()).toBe(200);
    expect(seen).toEqual([ID.toUpperCase()]);
  });
});
