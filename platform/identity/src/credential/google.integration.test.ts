import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { companyRequest, composed, type Composed } from '../testing/composed.js';

/**
 * Signing in with Google, against the real tables (`sign-in-with-google.ts`).
 * Google's token endpoint is the one thing stood in for: each code below
 * answers with the claims it was given, carrying the nonce of the trip.
 */

let identity: Composed;
const answers = new Map<string, Record<string, unknown>>();

beforeAll(async () => {
  identity = await composed({
    googleClientId: 'client-1',
    googleClientSecret: 'secret-1',
    googleExchange: (code) => Promise.resolve(answers.get(code) ?? null),
  });
});

afterAll(async () => {
  await (identity as Composed | undefined)?.stop();
});

const tenants = '/api/internal/admin/tenants';

async function company(slug: string, google: boolean): Promise<string> {
  const created = await identity.call('POST', tenants, companyRequest(slug));
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = String(created.body['tenantId']);
  const detail = await identity.call('GET', `${tenants}/${id}`);
  const amended = await identity.call('PATCH', `${tenants}/${id}`, {
    displayName: detail.body['displayName'],
    themeId: detail.body['themeId'],
    logoUrl: null,
    coverImageUrl: null,
    brandingPublic: true,
    googleSignIn: google,
  });
  expect(amended.status, JSON.stringify(amended.body)).toBe(200);
  return id;
}

/** To Google and back, as `who`, ending in identity's answer. */
async function trip(slug: string, who: Record<string, unknown>) {
  const begun = await identity.call('POST', '/api/internal/google/begin', { tenantSlug: slug });
  expect(begun.status).toBe(200);
  const url = new URL(String(begun.body['url']));
  const code = `code-${String(answers.size)}`;
  answers.set(code, {
    email_verified: true,
    nonce: url.searchParams.get('nonce'),
    ...who,
  });
  return identity.call('POST', '/api/internal/google/finish', {
    code,
    state: url.searchParams.get('state'),
    device: { userAgent: 'test' },
  });
}

const ada = {
  sub: 'google-ada',
  email: 'Ada@acme.example',
  hd: 'acme.example',
  given_name: 'Ada',
  family_name: 'Lovelace',
};

describe('signing in with Google', () => {
  let acme: string;
  beforeAll(async () => {
    acme = await company('acme', true);
  });

  it('enrols the invited administrator on the first sign-in and links the Google account', async () => {
    const finished = await trip('acme', ada);
    expect(finished.status, JSON.stringify(finished.body)).toBe(200);
    expect(finished.body).toMatchObject({ tenantSlug: 'acme', app: null });

    const redeemed = await identity.call('POST', '/api/internal/handoff/redeem', {
      code: finished.body['code'],
      tenantId: acme,
    });
    expect(redeemed.status).toBe(200);
    expect(typeof redeemed.body['sessionId']).toBe('string');

    const [account] = await identity.sql`
      SELECT status FROM platform.account WHERE tenant_id = ${acme}::uuid AND lower(work_email) = 'ada@acme.example'`;
    expect(account?.['status']).toBe('active');
    const [session] = await identity.sql`
      SELECT amr FROM platform.session WHERE id = ${String(redeemed.body['sessionId'])}::uuid`;
    expect(session?.['amr']).toEqual(['fed']);
  });

  it('signs in by the link the next time, even after the address changes', async () => {
    const finished = await trip('acme', { ...ada, email: 'ada.lovelace@acme.example' });
    expect(finished.status, JSON.stringify(finished.body)).toBe(200);
  });

  it('refuses a personal Google account on the work address, and says where to go back to', async () => {
    const finished = await trip('acme', { ...ada, sub: 'personal-ada', hd: undefined });
    expect(finished).toEqual({ status: 401, body: { tenantSlug: 'acme' } });
  });

  it('refuses a Workspace account with no account at the company', async () => {
    const finished = await trip('acme', { ...ada, sub: 'google-bob', email: 'bob@acme.example' });
    expect(finished).toEqual({ status: 401, body: { tenantSlug: 'acme' } });
  });

  it('does not leave for Google from a company that has not switched it on', async () => {
    await company('globex', false);
    const begun = await identity.call('POST', '/api/internal/google/begin', {
      tenantSlug: 'globex',
    });
    expect(begun.status).toBe(404);
  });

  it('spends a trip once', async () => {
    const begun = await identity.call('POST', '/api/internal/google/begin', { tenantSlug: 'acme' });
    const url = new URL(String(begun.body['url']));
    answers.set('once', { ...ada, email_verified: true, nonce: url.searchParams.get('nonce') });
    const finish = () =>
      identity.call('POST', '/api/internal/google/finish', {
        code: 'once',
        state: url.searchParams.get('state'),
        device: { userAgent: 'test' },
      });
    expect((await finish()).status).toBe(200);
    expect(await finish()).toEqual({ status: 401, body: { tenantSlug: null } });
  });
});
