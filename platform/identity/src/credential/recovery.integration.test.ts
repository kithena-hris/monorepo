import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';

import { companyRequest, composed, type Composed } from '../testing/composed.js';
import { drizzleEnrolmentTokenStore } from './infrastructure/drizzle-enrolment-token-store.js';
import { softwareAuthenticator } from './testing/software-authenticator.js';

/**
 * The forgotten-passkey flow, over HTTP, as the auth origin drives it.
 *
 * The bug this pins (2026-09-27): a recovery link opened by somebody with no
 * name on file went straight to the passkey, ran the ceremony, was refused for
 * the missing name, and sent them back through the form to a second ceremony.
 * The page now asks first; what these tests prove is the service side of it —
 * the details and the tenant's own questions travel with the one ceremony,
 * nothing commits without a credential, and People hears what was entered.
 */

const PEOPLE_TOKEN = 'people-integration-token';
const ORIGIN = 'http://auth.app.localhost:3100';
const RP_ID = 'app.localhost';

let identity: Composed;
let tenantId = '';
let accountId = '';
let identityId = '';

beforeAll(async () => {
  identity = await composed({ defaultEntitlements: [], peopleToken: PEOPLE_TOKEN });
  const created = await identity.call(
    'POST',
    '/api/internal/admin/tenants',
    companyRequest('recovering'),
  );
  tenantId = String(created.body['tenantId']);
  const [row] = await identity.sql<{ id: string; identity_id: string }[]>`
    SELECT id, identity_id FROM platform.account WHERE tenant_id = ${tenantId}::uuid`;
  accountId = row?.id ?? '';
  identityId = row?.identity_id ?? '';

  // The tenant's own question, as People reports it.
  const put = await fetch(`${identity.url}/api/internal/tenants/${tenantId}/signup-questions`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-internal-token': PEOPLE_TOKEN },
    body: JSON.stringify({
      asOf: '2026-09-27T09:00:00.000Z',
      schemaVersion: 4,
      questions: [
        {
          key: 't_shirt',
          label: 'T-shirt size',
          description: null,
          dataType: 'select',
          required: true,
          options: [
            { value: 's', label: 'Small' },
            { value: 'm', label: 'Medium' },
          ],
          maxLength: null,
          min: null,
          max: null,
          decimals: null,
          classification: 'internal',
        },
      ],
    }),
  });
  expect(put.status).toBe(204);
});

afterAll(async () => {
  await (identity as Composed | undefined)?.stop();
});

/** An active account with a lost passkey and, like the reported one, no name on file. */
beforeEach(async () => {
  await identity.sql`DELETE FROM platform.enrolment_token WHERE account_id = ${accountId}::uuid`;
  await identity.sql`DELETE FROM platform.credential WHERE identity_id = ${identityId}::uuid`;
  await identity.sql`DELETE FROM platform.outbox WHERE tenant_id = ${tenantId}::uuid`;
  await identity.sql`
    UPDATE platform.account
       SET status = 'active', given_name = NULL, family_name = NULL, preferred_name = NULL,
           signup_answered = '{}', employment_start = '2026-01-01'
     WHERE id = ${accountId}::uuid`;
  await identity.sql`
    INSERT INTO platform.credential (id, identity_id, kind, external_id, provider, public_key, sign_count, backed_up)
    VALUES (gen_random_uuid(), ${identityId}::uuid, 'passkey', 'the-lost-one', 'software', '\\x00', 0, false)`;
});

async function recoveryLink(): Promise<string> {
  const issued = await drizzleEnrolmentTokenStore(drizzle(identity.sql), tenantId).issue({
    accountId,
    purpose: 'recovery',
    secondChannel: 'known_value',
    issuedBy: null,
  });
  return issued.token;
}

/** Begin, create a passkey in software, finish: the page's one ceremony. */
async function ceremony(token: string, body: Record<string, unknown>, origin = ORIGIN) {
  const begun = await identity.call('POST', '/api/internal/webauthn/register/begin', {
    identityId,
    displayName: 'Ada Lovelace',
  });
  const options = begun.body['options'] as { challenge: string };
  const response = softwareAuthenticator(`key-${String(Math.random())}`).register({
    challenge: options.challenge,
    origin,
    rpId: RP_ID,
  });
  return identity.call('POST', '/api/internal/webauthn/register/finish', {
    tenantId,
    token,
    origin: ORIGIN,
    response,
    ...body,
  });
}

const liveLinks = async () =>
  Number(
    (
      await identity.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM platform.enrolment_token
         WHERE account_id = ${accountId}::uuid AND consumed_at IS NULL`
    )[0]?.n,
  );
const liveCredentials = async () =>
  identity.sql<{ external_id: string }[]>`
    SELECT external_id FROM platform.credential
     WHERE identity_id = ${identityId}::uuid AND revoked_at IS NULL`;

const name = { given: 'Ada', family: 'Lovelace', preferred: '' };

describe('a recovery link for somebody with nothing on file', () => {
  it('says what it will ask before anybody is prompted for a passkey', async () => {
    const status = await identity.call('POST', '/api/internal/enrolment/status', {
      tenantId,
      token: await recoveryLink(),
    });
    expect(status.body).toMatchObject({ state: 'usable', purpose: 'recovery', name: null });
    expect((status.body['questions'] as { key: string }[]).map((q) => q.key)).toEqual(['t_shirt']);
  });

  it('registers one passkey with the details, and tells People what was entered', async () => {
    const token = await recoveryLink();
    const finished = await ceremony(token, { name, answers: { t_shirt: 'm' } });
    expect(finished.status, JSON.stringify(finished.body)).toBe(200);

    // The lost passkey stops working; the new one is the only one left.
    expect((await liveCredentials()).map((c) => c.external_id)).not.toContain('the-lost-one');
    expect(await liveCredentials()).toHaveLength(1);

    expect(await identity.events('identity.account.recovered')).toHaveLength(1);
    expect(await identity.events('identity.account.profile_captured')).toMatchObject([
      { accountId, name: { given: 'Ada', family: 'Lovelace', preferred: null } },
    ]);
    expect(await identity.events('identity.account.signup_answered')).toMatchObject([
      { accountId, schemaVersion: 4, answers: { t_shirt: 'm' } },
    ]);

    // The key is remembered, the value is not.
    const [row] = await identity.sql<{ signup_answered: string[]; given_name: string }[]>`
      SELECT signup_answered, given_name FROM platform.account WHERE id = ${accountId}::uuid`;
    expect(row).toEqual({ signup_answered: ['t_shirt'], given_name: 'Ada' });

    // Answered, so the next link asks nothing.
    const again = await identity.call('POST', '/api/internal/enrolment/status', {
      tenantId,
      token: await recoveryLink(),
    });
    expect(again.body['questions']).toEqual([]);
  });

  it('refuses the same link a second time, and registers nothing more', async () => {
    const token = await recoveryLink();
    expect((await ceremony(token, { name, answers: { t_shirt: 's' } })).status).toBe(200);
    const second = await ceremony(token, { name, answers: { t_shirt: 's' } });
    expect(second.status).toBe(401);
    expect(second.body).toEqual({ reason: 'link_used_or_expired' });
    expect(await liveCredentials()).toHaveLength(1);
  });

  it('leaves the link live, and nothing behind, when the passkey is rejected', async () => {
    const token = await recoveryLink();
    const rejected = await ceremony(
      token,
      { name, answers: { t_shirt: 'm' } },
      'http://elsewhere.test',
    );
    expect(rejected.body).toEqual({ reason: 'passkey_rejected' });
    expect(await liveLinks()).toBe(1);
    expect((await liveCredentials()).map((c) => c.external_id)).toEqual(['the-lost-one']);
    expect(await identity.events('identity.account.recovered')).toEqual([]);

    // And the same link then works.
    expect((await ceremony(token, { name, answers: { t_shirt: 'm' } })).status).toBe(200);
  });

  it('refuses a missing required answer before spending the link', async () => {
    const token = await recoveryLink();
    const refused = await ceremony(token, { name });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ reason: 'answers_invalid', path: ['t_shirt'] });
    expect(await liveLinks()).toBe(1);
  });
});

describe('the question set', () => {
  it('is refused when it would ask for anything above internal', async () => {
    const put = await fetch(`${identity.url}/api/internal/tenants/${tenantId}/signup-questions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-internal-token': PEOPLE_TOKEN },
      body: JSON.stringify({
        asOf: '2026-09-27T10:00:00.000Z',
        schemaVersion: 5,
        questions: [
          {
            key: 'salary_expectation',
            label: 'Salary',
            description: null,
            dataType: 'number',
            required: false,
            options: [],
            maxLength: null,
            min: null,
            max: null,
            decimals: null,
            classification: 'confidential',
          },
        ],
      }),
    });
    expect(put.status).toBe(400);
  });

  it('is only People’s to report', async () => {
    const put = await fetch(`${identity.url}/api/internal/tenants/${tenantId}/signup-questions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-internal-token': 'somebody-else' },
      body: '{}',
    });
    expect(put.status).toBe(401);
  });
});
