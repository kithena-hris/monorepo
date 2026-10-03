import { describe, expect, it } from 'vitest';

import { issueScimConnection, revokeScimConnection } from '../application/member/scim.js';
import { caller, hr, people, TENANT, world } from '../application/testing/world.js';
import { SCIM_PREFIX, scimHandler } from './scim.js';

/**
 * SCIM 2.0 provisioning for a company without People (TOF-114), as an
 * identity provider drives it: match by userName, create, patch the way Entra
 * patches, deactivate.
 */

const BASE = `https://timeoff.example${SCIM_PREFIX}`;

async function setup() {
  const app = world('2026-10-01T07:00:00.000Z', { members: false });
  const issued = await issueScimConnection(app.deps)(hr);
  if (!issued.ok) throw new Error(issued.error.message);
  const scim = scimHandler(app.deps, BASE);
  const send = (method: string, path: string, body?: unknown, token = issued.value.token) =>
    scim({
      method,
      url: `${SCIM_PREFIX}${path}`,
      headers: { authorization: `Bearer ${token}` },
      body: body === undefined ? '' : JSON.stringify(body),
    });
  return { app, send, connection: issued.value };
}

const ADA = {
  schemas: [
    'urn:ietf:params:scim:schemas:core:2.0:User',
    'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
    'urn:kithena:params:scim:schemas:extension:timeoff:2.0:User',
  ],
  userName: 'ada.lovelace@acme.example',
  externalId: 'entra-ada',
  name: { givenName: 'Ada', familyName: 'Lovelace' },
  emails: [{ value: 'ada.lovelace@acme.example', type: 'work', primary: true }],
  active: true,
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': { department: 'People Ops' },
  'urn:kithena:params:scim:schemas:extension:timeoff:2.0:User': {
    hireDate: '2024-02-01',
    locationKey: 'madrid',
    country: 'ES',
    timeZone: 'Europe/Madrid',
  },
};

describe('SCIM 2.0 provisioning (TOF-114)', () => {
  it('only HR issues a connection, and only its token is let in', async () => {
    const app = world();
    expect(await issueScimConnection(app.deps)(caller(people.adam))).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    const { send, connection, app: other } = await setup();
    expect((await send('GET', '/ServiceProviderConfig')).status).toBe(200);
    const refused = await send('GET', '/Users', undefined, 'kts_nonsense');
    expect(refused).toMatchObject({
      status: 401,
      headers: { 'www-authenticate': 'Bearer realm="timeoff-scim"' },
    });
    await revokeScimConnection(other.deps)(hr, connection.id);
    expect((await send('GET', '/Users')).status).toBe(401);
  });

  it('creates a member from a User, as a hire, and finds it by userName', async () => {
    const { app, send } = await setup();
    const created = await send('POST', '/Users', ADA);
    expect(created.status).toBe(201);
    const id = String(created.body?.['id']);
    expect(created.headers['location']).toBe(`${BASE}/Users/${id}`);
    expect(created.body).toMatchObject({
      userName: 'ada.lovelace@acme.example',
      externalId: 'entra-ada',
      displayName: 'Ada Lovelace',
      active: true,
      'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': { department: 'People Ops' },
    });
    expect(app.state(TENANT).members.get(id as never)).toMatchObject({
      firstName: 'Ada',
      workEmail: 'ada.lovelace@acme.example',
      teamKey: 't_people_ops',
      hireDate: '2024-02-01',
      locationKey: 'madrid',
      status: 'active',
    });

    const found = await send(
      'GET',
      `/Users?filter=${encodeURIComponent('userName eq "ADA.lovelace@acme.example"')}`,
    );
    expect(found.body).toMatchObject({ totalResults: 1, Resources: [{ id }] });
    const none = await send('GET', `/Users?filter=${encodeURIComponent('externalId eq "nobody"')}`);
    expect(none.body).toMatchObject({ totalResults: 0, Resources: [] });
    expect(
      (await send('GET', `/Users?filter=${encodeURIComponent('displayName co "Ada"')}`)).body,
    ).toMatchObject({ scimType: 'invalidFilter', status: '400' });
  });

  it('refuses a second user with the same userName, whatever its case', async () => {
    const { send } = await setup();
    await send('POST', '/Users', ADA);
    const again = await send('POST', '/Users', { ...ADA, userName: 'Ada.Lovelace@acme.example' });
    expect(again).toMatchObject({ status: 409, body: { scimType: 'uniqueness' } });
  });

  it('patches the way Entra does, and deactivating ends the member, who stays', async () => {
    const { app, send } = await setup();
    const id = String((await send('POST', '/Users', ADA)).body?.['id']);
    const patched = await send('PATCH', `/Users/${id}`, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [
        { op: 'Replace', path: 'displayName', value: 'Ada King' },
        { op: 'Add', path: 'emails[type eq "work"].value', value: 'ada.king@acme.example' },
        { op: 'Replace', path: 'active', value: 'False' },
      ],
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ displayName: 'Ada King', active: false });
    expect(app.state(TENANT).members.get(id as never)).toMatchObject({
      workEmail: 'ada.king@acme.example',
      status: 'left',
      terminationDate: '2026-10-01',
    });

    expect((await send('DELETE', `/Users/${id}`)).status).toBe(204);
    expect(app.state(TENANT).members.get(id as never)?.status).toBe('left');
    expect((await send('GET', `/Users/${id}`)).body).toMatchObject({ active: false });
  });

  it('answers in SCIM’s own errors', async () => {
    const { send } = await setup();
    expect(await send('GET', '/Users/00000000-0000-7000-8000-000000000999')).toMatchObject({
      status: 404,
      body: { schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '404' },
    });
    expect((await send('POST', '/Users', { name: { givenName: 'No' } })).body).toMatchObject({
      scimType: 'invalidValue',
    });
  });
});
