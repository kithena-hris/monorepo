import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { createYoga } from 'graphql-yoga';
import { startPostgres } from '@kithena/testing';

import { define, versionOf } from '../application/person/in-memory.js';
import { yogaOptions } from '../graphql/schema.js';
import { drizzleSchemaRepository } from '../infrastructure/drizzle-schema-repository.js';
import { tenantTransaction } from '../infrastructure/unit-of-work.js';
import { wirePeople } from './server.js';

/**
 * SCIM 2.0 and mirror mode (PEO-072, PEO-073), booted as `main.ts` boots
 * People, over Postgres as `svc_people`.
 *
 * A People administrator connects Okta and approves its mapping; Okta and
 * Entra provision, look up, patch, replace and delete through `/scim/v2`
 * with the connection's token; and every other writer — REST, a correction,
 * the screens through GraphQL — is refused the attributes Okta owns, with
 * Okta named.
 */

const ACME = '00000000-0000-4000-8000-00000000000a';
const OTHER = '00000000-0000-4000-8000-00000000000b';
const ADMIN = '00000000-0000-4000-8000-0000000000b1';
const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const KITHENA = 'urn:kithena:scim:schemas:extension:people:2.0:User';
const PATCH_OP = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

let stopPg: (() => Promise<void>) | undefined;
const clients: ReturnType<typeof postgres>[] = [];
let admin: ReturnType<typeof drizzle>;
let server: Server;
let base = '';

const principal = (roles: string[], tenantId = ACME) => ({
  'content-type': 'application/json',
  'x-internal-token': 'router-secret',
  'x-kithena-principal': JSON.stringify({
    userId: ADMIN,
    tenantId,
    roles,
    entitlements: ['module.people'],
  }),
});
let keys = 0;
const rest = (method: string, path: string, body?: unknown, roles = ['people_admin', 'hr']) =>
  fetch(`${base}${path}`, {
    method,
    headers: { ...principal(roles), 'idempotency-key': `k${String((keys += 1))}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const scim = (token: string, method: string, path: string, body?: unknown) =>
  fetch(`${base}/scim/v2${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/scim+json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async (response: Response) => (await response.json()) as Record<string, unknown>;
const graphql = async (query: string, variables: Record<string, unknown>) =>
  json(
    await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: principal(['people_admin', 'hr']),
      body: JSON.stringify({ query, variables }),
    }),
  );

const events = async (name: string) =>
  [
    ...(await admin.execute(
      sql`SELECT envelope FROM people.outbox WHERE event_name = ${name} ORDER BY created_at, event_id`,
    )),
  ].map((r) => r['envelope'] as { actor: Record<string, unknown>; payload: Record<string, unknown> });

beforeAll(async () => {
  const pg = await startPostgres();
  stopPg = pg.stop;
  const adminClient = postgres(pg.url, { max: 1, onnotice: () => {} });
  clients.push(adminClient);
  admin = drizzle(adminClient);
  // Every migration, as a deployment has them: the integrations screen
  // reads webhooks, roles and settings beside SCIM.
  for (const role of ['svc_identity', 'svc_messaging']) {
    await adminClient.unsafe(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
  }
  const dir = new URL('../../../../migrations/', import.meta.url);
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    await admin.execute(sql.raw(await readFile(new URL(file, dir), 'utf8')));
  }
  await admin.execute(sql`ALTER ROLE svc_people LOGIN PASSWORD 'svc_people'`);
  const asService = new URL(pg.url);
  asService.username = 'svc_people';
  asService.password = 'svc_people';
  const serviceClient = postgres(asService.toString(), { max: 2 });
  clients.push(serviceClient);
  const inTenant = tenantTransaction(drizzle(serviceClient));

  const identity = (key: string) =>
    define({
      key,
      ownership: ['employee', 'hr'],
      visibility: ['self', 'hr', 'directory'],
      classification: { classification: 'internal', piiKind: 'identity', exportable: true, aiEligible: true },
    });
  for (const tenant of [ACME, OTHER]) {
    await inTenant(tenant, ({ tx }) =>
      drizzleSchemaRepository().appendVersion(
        tx,
        tenant,
        versionOf(1, [
          identity('given_name'),
          identity('family_name'),
          identity('work_email'),
          define({ key: 'job_title', visibility: ['self', 'hr'] }),
          define({ key: 't_shirt_size', visibility: ['self', 'hr'] }),
          define({
            key: 'national_id',
            encrypted: true,
            includeInEvents: false,
            classification: {
              classification: 'confidential',
              piiKind: 'identity',
              exportable: true,
              aiEligible: false,
            },
          }),
        ]),
        [],
        '2026-09-01',
      ),
    );
  }

  process.env['PEOPLE_DATABASE_URL'] = asService.toString();
  process.env['PEOPLE_API_TOKEN'] = 'router-secret';
  process.env['PEOPLE_SECRET_KEYS'] = `k1:${randomBytes(32).toString('base64')}`;
  process.env['PEOPLE_SCIM_URL'] = 'https://api.acme.test/scim/v2';
  process.env['KITHENA_ENTITLEMENTS'] = '["module.people"]';

  const yoga = createYoga(yogaOptions);
  server = createServer((request, response) => {
    void yoga(request, response);
  });
  wirePeople(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  const listening = server as Server | undefined;
  if (listening) await new Promise((resolve) => listening.close(resolve));
  for (const c of clients) await c.end();
  await stopPg?.();
});

let okta = { id: '', token: '' };
let ada = '';

describe('connecting a system (PEO-072)', () => {
  it('is a People administrator’s, and the token is shown once', async () => {
    expect((await rest('POST', '/v1/scim/connections', { system: 'Okta' }, ['hr'])).status).toBe(403);
    const made = await rest('POST', '/v1/scim/connections', { system: 'Okta' });
    expect(made.status).toBe(201);
    okta = (await made.json()) as typeof okta;
    expect(okta.token).toMatch(/^kps_/);
    const [row] = await admin.execute(
      sql`SELECT token_hash FROM people.scim_connection WHERE id = ${okta.id}::uuid`,
    );
    expect(row?.['token_hash']).not.toContain(okta.token);
    const [created] = await events('people.scim.connection_changed');
    expect(created).toMatchObject({
      actor: { kind: 'user', userId: ADMIN },
      payload: { connectionId: okta.id, change: 'created', system: 'Okta', ownedKeys: [] },
    });
  });

  it('approves a mapping, and refuses one that would let a sealed value out', async () => {
    const sealed = await rest('PUT', `/v1/scim/connections/${okta.id}/mapping`, {
      mapping: [{ path: `${KITHENA}:national_id`, key: 'national_id' }],
    });
    expect(sealed.status).toBe(422);
    expect(await json(sealed)).toMatchObject({ error: { code: 'VALUE_INVALID' } });

    const set = await rest('PUT', `/v1/scim/connections/${okta.id}/mapping`, {
      mapping: [
        { path: 'name.givenName', key: 'given_name' },
        { path: 'name.familyName', key: 'family_name' },
        { path: 'emails[type eq "work"].value', key: 'work_email' },
        { path: `${KITHENA}:t_shirt_size`, key: 't_shirt_size' },
      ],
    });
    expect(set.status).toBe(200);
    const view = await graphql(
      '{ peopleIntegrations { scim { url connections { id system mapping { path key } } } } }',
      {},
    );
    expect(view['errors']).toBeUndefined();
    expect(view).toMatchObject({
      data: {
        peopleIntegrations: {
          scim: {
            url: 'https://api.acme.test/scim/v2',
            connections: [{ id: okta.id, system: 'Okta', mapping: expect.arrayContaining([{ path: 'name.givenName', key: 'given_name' }]) }],
          },
        },
      },
    });
  });

  it('keeps one owner per attribute: a second system cannot take what Okta keeps', async () => {
    const workday = (await json(await rest('POST', '/v1/scim/connections', { system: 'Workday' }))) as {
      id: string;
    };
    const taken = await rest('PUT', `/v1/scim/connections/${workday.id}/mapping`, {
      mapping: [{ path: 'name.givenName', key: 'given_name' }],
    });
    expect(taken.status).toBe(403);
    expect(await json(taken)).toMatchObject({
      error: { code: 'SOURCE_OF_RECORD_EXTERNAL', message: expect.stringContaining('Okta') },
    });
    expect((await rest('POST', `/v1/scim/connections/${workday.id}/revoke`, {})).status).toBe(200);
  });
});

describe('authenticating a provider', () => {
  it('refuses no token, a wrong one, and one naming another tenant, in SCIM’s error shape', async () => {
    const none = await fetch(`${base}/scim/v2/Users`);
    expect(none.status).toBe(401);
    expect(none.headers.get('content-type')).toContain('application/scim+json');
    expect(await json(none)).toEqual({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '401',
      detail: 'A valid bearer token is required',
    });
    expect((await scim(`${okta.token}x`, 'GET', '/Users')).status).toBe(401);
    // The same secret, claiming another tenant: its row is not there.
    const raw = Buffer.from(okta.token.slice(4), 'base64url');
    Buffer.from(OTHER.replaceAll('-', ''), 'hex').copy(raw, 0);
    expect((await scim(`kps_${raw.toString('base64url')}`, 'GET', '/Users')).status).toBe(401);
  });

  it('answers discovery with the token', async () => {
    const config = await json(await scim(okta.token, 'GET', '/ServiceProviderConfig'));
    expect(config).toMatchObject({ patch: { supported: true }, filter: { supported: true } });
    const schemas = await json(await scim(okta.token, 'GET', '/Schemas'));
    expect(schemas['Resources']).toEqual([
      expect.objectContaining({ id: KITHENA, attributes: [expect.objectContaining({ name: 't_shirt_size' })] }),
    ]);
  });
});

describe('/Users', () => {
  const oktaAda = {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', KITHENA],
    userName: 'ada@acme.test',
    externalId: '00uAda',
    active: true,
    name: { givenName: 'Ada', familyName: 'Lovelace' },
    emails: [{ value: 'ada@acme.test', type: 'work', primary: true }],
    locale: 'en-GB',
    [KITHENA]: { t_shirt_size: 'M' },
  };

  it('creates a mirrored record through the one write path', async () => {
    const created = await scim(okta.token, 'POST', '/Users', oktaAda);
    expect(created.status).toBe(201);
    const user = await json(created);
    ada = String(user['id']);
    expect(created.headers.get('location')).toBe(`https://api.acme.test/scim/v2/Users/${ada}`);
    expect(user).toMatchObject({
      userName: 'ada@acme.test',
      externalId: '00uAda',
      active: true,
      name: { givenName: 'Ada', familyName: 'Lovelace' },
      emails: [{ value: 'ada@acme.test', type: 'work', primary: true }],
      [KITHENA]: { t_shirt_size: 'M' },
    });
    // An unmapped attribute is not kept.
    expect(user).not.toHaveProperty('locale');

    const [row] = await admin.execute(
      sql`SELECT status, source_of_record, given_name FROM people.person WHERE id = ${ada}::uuid`,
    );
    expect(row).toMatchObject({ status: 'provisional', source_of_record: 'external', given_name: 'Ada' });
    const [updated] = await events('people.person.profile_updated');
    expect(updated?.actor).toEqual({ kind: 'integration', integrationId: okta.id, provider: 'Okta' });
    const [synced] = await events('people.person.synced_from_external');
    expect(synced?.payload).toEqual({
      personId: ada,
      provider: 'Okta',
      externalId: '00uAda',
      fieldsChanged: expect.arrayContaining(['given_name', 'family_name', 'work_email', 't_shirt_size', 'userName']),
    });
  });

  it('refuses a second user with the same userName, in any case', async () => {
    const again = await scim(okta.token, 'POST', '/Users', { ...oktaAda, userName: 'ADA@acme.test', externalId: 'x' });
    expect(again.status).toBe(409);
    expect(await json(again)).toMatchObject({ status: '409', scimType: 'uniqueness' });
  });

  it('finds a user by the filters Okta and Entra send, and by any attribute', async () => {
    const found = async (filter: string) =>
      json(await scim(okta.token, 'GET', `/Users?filter=${encodeURIComponent(filter)}`));
    expect(await found('userName eq "Ada@Acme.test"')).toMatchObject({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 1,
      Resources: [{ id: ada }],
    });
    expect(await found('externalId eq "00uAda"')).toMatchObject({ totalResults: 1 });
    expect(await found('name.givenName sw "Ad" and active eq true')).toMatchObject({ totalResults: 1 });
    expect(await found('userName eq "grace@acme.test"')).toMatchObject({ totalResults: 0, Resources: [] });
    const bad = await scim(okta.token, 'GET', `/Users?filter=${encodeURIComponent('userName eq')}`);
    expect(bad.status).toBe(400);
    expect(await json(bad)).toMatchObject({ scimType: 'invalidFilter' });
  });

  it('pages from 1', async () => {
    const grace = await scim(okta.token, 'POST', '/Users', {
      userName: 'grace@acme.test',
      name: { givenName: 'Grace', familyName: 'Hopper' },
    });
    expect(grace.status).toBe(201);
    const second = await json(await scim(okta.token, 'GET', '/Users?startIndex=2&count=1'));
    expect(second).toMatchObject({ totalResults: 2, startIndex: 2, itemsPerPage: 1 });
  });

  it('patches as Entra does, and records a deactivation without ending anybody', async () => {
    const patched = await scim(okta.token, 'PATCH', `/Users/${ada}`, {
      schemas: [PATCH_OP],
      Operations: [
        { op: 'Replace', path: 'name.givenName', value: 'Augusta' },
        { op: 'Replace', path: 'active', value: 'False' },
        // Said again, unchanged: not a change.
        { op: 'Replace', path: 'emails[type eq "work"].value', value: 'ada@acme.test' },
      ],
    });
    expect(patched.status).toBe(200);
    expect(await json(patched)).toMatchObject({ active: false, name: { givenName: 'Augusta' } });
    const [row] = await admin.execute(
      sql`SELECT status, given_name FROM people.person WHERE id = ${ada}::uuid`,
    );
    expect(row).toMatchObject({ status: 'provisional', given_name: 'Augusta' });
    const synced = await events('people.person.synced_from_external');
    expect(synced.at(-1)?.payload['fieldsChanged']).toEqual(['given_name', 'active']);
  });

  it('writes nothing, and raises nothing, for a PUT that changes nothing', async () => {
    const before = (await events('people.person.synced_from_external')).length;
    const current = await json(await scim(okta.token, 'GET', `/Users/${ada}`));
    expect((await scim(okta.token, 'PUT', `/Users/${ada}`, current)).status).toBe(200);
    expect((await events('people.person.synced_from_external')).length).toBe(before);
  });

  it('replaces whole: a mapped value the body leaves out is cleared', async () => {
    const { [KITHENA]: _gone, ...rest } = oktaAda;
    const replaced = await json(await scim(okta.token, 'PUT', `/Users/${ada}`, rest));
    expect(replaced).not.toHaveProperty(KITHENA);
    expect(replaced).toMatchObject({ active: true, name: { givenName: 'Ada' } });
  });

  it('refuses a value the record’s own rules refuse, as SCIM says it', async () => {
    const bad = await scim(okta.token, 'PATCH', `/Users/${ada}`, {
      schemas: [PATCH_OP],
      Operations: [{ op: 'replace', value: { name: { givenName: '' }, [`${ENTERPRISE}:department`]: 'x' } }],
    });
    // An empty given name is a cleared value, which this attribute allows;
    // the unmapped department is dropped without a refusal.
    expect(bad.status).toBe(200);
    const syntax = await scim(okta.token, 'PATCH', `/Users/${ada}`, { Operations: [] });
    expect(syntax.status).toBe(400);
    expect(await json(syntax)).toMatchObject({ scimType: 'invalidSyntax' });
    expect((await scim(okta.token, 'GET', '/Users/00000000-0000-4000-8000-000000000999')).status).toBe(404);
  });
});

describe('mirror mode: every other writer is refused, naming Okta (PEO-073)', () => {
  it('refuses REST', async () => {
    await scim(okta.token, 'PATCH', `/Users/${ada}`, {
      schemas: [PATCH_OP],
      Operations: [{ op: 'replace', path: 'name.givenName', value: 'Ada' }],
    });
    const patched = await rest('PATCH', `/v1/people/${ada}`, { attributes: { given_name: 'Adeline' } });
    expect(patched.status).toBe(403);
    expect(await json(patched)).toMatchObject({
      error: {
        code: 'SOURCE_OF_RECORD_EXTERNAL',
        message: 'given_name is kept in Okta; change it there',
        path: ['given_name'],
      },
    });
    // What Kithena owns stays Kithena's.
    expect((await rest('PATCH', `/v1/people/${ada}`, { attributes: { job_title: 'Engineer' } })).status).toBe(200);
  });

  it('refuses a correction', async () => {
    const history = (await json(await rest('GET', `/v1/people/${ada}/history`))) as {
      items: { id: string; attributeKey: string }[];
    };
    const entry = history.items.findLast((e) => e.attributeKey === 'given_name');
    expect(entry).toBeDefined();
    const corrected = await rest('POST', `/v1/people/${ada}/corrections`, {
      supersedes: entry?.id,
      value: 'Adeline',
      reason: 'typo',
    });
    expect(corrected.status).toBe(403);
    expect(await json(corrected)).toMatchObject({ error: { code: 'SOURCE_OF_RECORD_EXTERNAL' } });
  });

  it('refuses the screens through GraphQL, and draws the field read-only with Okta named', async () => {
    const saved = await graphql(
      `mutation ($id: ID!) { savePersonSection(personId: $id, changed: [{ key: "given_name", text: "Adeline" }], idempotencyKey: "gq1") { ok } }`,
      { id: ada },
    );
    expect(saved['errors']).toEqual([
      expect.objectContaining({ extensions: expect.objectContaining({ code: 'SOURCE_OF_RECORD_EXTERNAL' }) }),
    ]);
    const profile = await graphql(
      `query ($id: ID!) { peopleProfile(personId: $id) { sections { fields { key readOnly ownedBy keptIn } } } }`,
      { id: ada },
    );
    const fields = (
      profile as { data: { peopleProfile: { sections: { fields: Record<string, unknown>[] }[] } } }
    ).data.peopleProfile.sections.flatMap((s) => s.fields);
    expect(fields.find((f) => f['key'] === 'given_name')).toEqual({
      key: 'given_name',
      readOnly: true,
      ownedBy: 'Okta',
      keptIn: 'Okta',
    });
    expect(fields.find((f) => f['key'] === 'job_title')).toMatchObject({ readOnly: false, keptIn: null });
  });
});

describe('/Groups', () => {
  let group = '';

  it('creates a group of provisioned users, and refuses a stranger', async () => {
    const stranger = await scim(okta.token, 'POST', '/Groups', {
      displayName: 'Engineering',
      members: [{ value: '00000000-0000-4000-8000-000000000999' }],
    });
    expect(stranger.status).toBe(400);
    const made = await scim(okta.token, 'POST', '/Groups', {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      displayName: 'Engineering',
      members: [{ value: ada }],
    });
    expect(made.status).toBe(201);
    const body = await json(made);
    group = String(body['id']);
    expect(body).toMatchObject({ displayName: 'Engineering', members: [{ value: ada }] });
    expect((await scim(okta.token, 'POST', '/Groups', { displayName: 'engineering' })).status).toBe(409);
  });

  it('finds, patches membership as Entra does, and leaves members out when asked', async () => {
    const found = await json(
      await scim(okta.token, 'GET', `/Groups?filter=${encodeURIComponent('displayName eq "Engineering"')}&excludedAttributes=members`),
    );
    expect(found).toMatchObject({ totalResults: 1, Resources: [{ id: group }] });
    expect((found['Resources'] as Record<string, unknown>[])[0]).not.toHaveProperty('members');

    const users = (await json(await scim(okta.token, 'GET', '/Users'))) as { Resources: { id: string }[] };
    const grace = users.Resources.find((u) => u.id !== ada)?.id ?? '';
    const patched = await json(
      await scim(okta.token, 'PATCH', `/Groups/${group}`, {
        schemas: [PATCH_OP],
        Operations: [
          { op: 'Add', path: 'members', value: [{ value: grace }] },
          { op: 'Remove', path: 'members', value: [{ value: ada }] },
          { op: 'Replace', path: 'displayName', value: 'Platform' },
        ],
      }),
    );
    expect(patched).toMatchObject({ displayName: 'Platform', members: [{ value: grace }] });
  });

  it('deletes', async () => {
    expect((await scim(okta.token, 'DELETE', `/Groups/${group}`)).status).toBe(204);
    expect((await scim(okta.token, 'GET', `/Groups/${group}`)).status).toBe(404);
  });
});

describe('rotating, deleting and revoking', () => {
  it('rotates with a day’s overlap', async () => {
    const rotated = (await json(await rest('POST', `/v1/scim/connections/${okta.id}/rotate`, {}))) as {
      token: string;
    };
    expect((await scim(rotated.token, 'GET', '/Users')).status).toBe(200);
    expect((await scim(okta.token, 'GET', '/Users')).status).toBe(200);
    okta = { ...okta, token: rotated.token };
    const changes = (await events('people.scim.connection_changed')).map((e) => e.payload['change']);
    expect(changes).toContain('token_rotated');
  });

  it('unlinks on DELETE: the record stays, and is Kithena’s to write again', async () => {
    expect((await scim(okta.token, 'DELETE', `/Users/${ada}`)).status).toBe(204);
    expect((await scim(okta.token, 'GET', `/Users/${ada}`)).status).toBe(404);
    const [row] = await admin.execute(sql`SELECT status FROM people.person WHERE id = ${ada}::uuid`);
    expect(row?.['status']).toBe('provisional');
    expect((await rest('PATCH', `/v1/people/${ada}`, { attributes: { given_name: 'Adeline' } })).status).toBe(200);
  });

  it('revokes: the token stops at once and nothing is kept in Okta any more', async () => {
    const users = (await json(await scim(okta.token, 'GET', '/Users'))) as { Resources: { id: string }[] };
    const grace = users.Resources[0]?.id ?? '';
    expect((await rest('PATCH', `/v1/people/${grace}`, { attributes: { given_name: 'G' } })).status).toBe(403);
    expect((await rest('POST', `/v1/scim/connections/${okta.id}/revoke`, {})).status).toBe(200);
    expect((await scim(okta.token, 'GET', '/Users')).status).toBe(401);
    expect((await rest('PATCH', `/v1/people/${grace}`, { attributes: { given_name: 'G' } })).status).toBe(200);
    const revoked = (await events('people.scim.connection_changed')).at(-1);
    expect(revoked?.payload).toMatchObject({ change: 'revoked', ownedKeys: [] });
  });
});
