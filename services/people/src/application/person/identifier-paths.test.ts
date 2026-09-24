import { describe, expect, it } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { ok } from '@kithena/domain-kit';

import { configureGraphQL, schema } from '../../graphql/schema.js';
import type { CallerFrom } from '../../http/caller.js';
import { inMemoryIdempotency } from '../../http/idempotency.js';
import { restHandler } from '../../http/rest.js';
import { screenRoutes, type ScreenRouteDeps } from '../../http/screens.js';
import { utcCalendars } from '../org/org.js';
import { commitImport } from '../import/commit.js';
import { asking as importing, attributes, commitDeps, csv } from '../import/fixture.js';
import { proposeMapping, resolveMapping } from '../import/mapping.js';
import { parseUpload } from '../import/parse.js';
import { define, inMemoryPeople, noTransaction as tx, TENANT, versionOf } from './in-memory.js';
import { personAccess } from './person-access.js';
import type { PeopleService } from './service.js';

/**
 * PEO-125: every path that writes a national identifier — an edit over REST,
 * a section save (the profile, onboarding, GraphQL), the completeness grid, a
 * correction, an import row — goes through the one gate, so a doubted value
 * is saved, queued for HR and answered with its findings. And a retry of any
 * keyed write answers with the findings the first did.
 */

const LUCIA = '00000000-0000-4000-8000-0000000000a1';
const LUCIA_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const HR_ACCOUNT = '00000000-0000-4000-8000-0000000000b9';
/** 12345678 mod 23 is Z: A is the wrong control letter. */
const WRONG = '12345678A';

const nif = define({
  key: 'es_nif',
  label: { default: 'NIF' },
  dataType: 'national_id',
  typeConfig: { kind: 'national_id', country: 'ES', scheme: 'nif' },
  ownership: ['employee', 'hr'],
  visibility: ['self', 'hr'],
  collectAt: 'onboarding',
});

function world(account = HR_ACCOUNT, roles = ['hr']) {
  const store = inMemoryPeople([versionOf(1, [nif])]);
  store.seed(LUCIA, { account: LUCIA_ACCOUNT });
  const service: PeopleService = {
    access: personAccess(store.deps),
    schemas: store.deps.schemas,
    inTenant: (_tenant, fn) => fn({ tx: {} as never }),
  };
  const callerFrom: CallerFrom = () =>
    ok({
      tenantId: TENANT,
      viewer: { accountId: account, roles: new Set(roles) },
      correlationId: '00000000-0000-4000-8000-0000000000c1',
    });
  const idempotency = inMemoryIdempotency();
  const screens = screenRoutes(
    {
      service,
      relations: store.deps.relations,
      clock: store.deps.clock,
      calendars: utcCalendars,
      personOf: (_tx: unknown, _tenant: string, of: string) =>
        Promise.resolve(of === LUCIA_ACCOUNT ? LUCIA : null),
      gapTotals: () => Promise.resolve({ waiting: 0, staff: [] }),
    } as unknown as ScreenRouteDeps,
    idempotency,
  );
  const rest = restHandler({ service, callerFrom, idempotency, screens });
  const send = async (method: string, url: string, body: unknown, key = 'k-1') =>
    rest({
      method,
      url,
      headers: { 'idempotency-key': key },
      body: JSON.stringify(body),
    });
  return { store, service, rest, callerFrom, send };
}

const pending = (store: ReturnType<typeof world>['store']) =>
  store.reviews.filter((r) => r.state === 'pending').map((r) => r.attributeKey);

describe('every write path queues a doubted identifier, and answers with its findings', () => {
  it('REST PATCH, and its retry answers the same', async () => {
    const { store, send } = world();
    const first = await send('PATCH', `/v1/people/${LUCIA}`, { attributes: { es_nif: WRONG } });
    const again = await send('PATCH', `/v1/people/${LUCIA}`, { attributes: { es_nif: WRONG } });
    const found = (first?.body as { identifierFindings: unknown }).identifierFindings;
    expect(found).toEqual([
      {
        key: 'es_nif',
        review: 'pending',
        findings: [expect.objectContaining({ code: 'check_mismatch' })],
      },
    ]);
    expect((again?.body as { identifierFindings: unknown }).identifierFindings).toEqual(found);
    expect(pending(store)).toEqual(['es_nif']);
  });

  it('a section save (profile and GraphQL), and its retry answers the same', async () => {
    const { store, send } = world();
    const url = `/v1/views/people/${LUCIA}/sections`;
    const first = await send('POST', url, { changed: { es_nif: WRONG } });
    const again = await send('POST', url, { changed: { es_nif: WRONG } });
    expect(first?.body).toEqual({
      ok: true,
      findings: [
        expect.objectContaining({ key: 'es_nif', label: 'NIF', level: 'mismatch', review: 'pending' }),
      ],
    });
    expect(again?.body).toEqual(first?.body);
    expect(pending(store)).toEqual(['es_nif']);
  });

  it('onboarding: the employee’s own section, and its retry answers the same', async () => {
    const { store, send } = world(LUCIA_ACCOUNT, []);
    const first = await send('POST', '/v1/views/me/sections', { changed: { es_nif: WRONG } });
    const again = await send('POST', '/v1/views/me/sections', { changed: { es_nif: WRONG } });
    expect((first?.body as { findings: unknown[] }).findings).toHaveLength(1);
    expect(again?.body).toEqual(first?.body);
    expect(pending(store)).toEqual(['es_nif']);
  });

  it('GraphQL savePersonSection answers with the findings', async () => {
    const { service, callerFrom, rest, store } = world();
    configureGraphQL({ service, callerFrom, rest });
    const yoga = createYoga({ schema });
    const response = await yoga.fetch('http://people.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `mutation ($id: ID!) {
          savePersonSection(personId: $id, changed: [{ key: "es_nif", text: "${WRONG}" }], idempotencyKey: "g-1") {
            ok findings { key level code review }
          }
        }`,
        variables: { id: LUCIA },
      }),
    });
    const body = (await response.json()) as {
      data: { savePersonSection: { findings: { review: string }[] } };
    };
    expect(body.data.savePersonSection.findings).toEqual([
      { key: 'es_nif', level: 'mismatch', code: 'check_mismatch', review: 'pending' },
    ]);
    expect(pending(store)).toEqual(['es_nif']);
  });

  it('the completeness grid, per cell, and its retry answers the same', async () => {
    const { store, send } = world();
    const cells = { changes: [{ personId: LUCIA, values: { es_nif: WRONG } }] };
    const checked = await send('POST', '/v1/views/completeness/identifier-check', cells);
    expect((checked?.body as { findings: unknown[] }).findings).toEqual([
      expect.objectContaining({ personId: LUCIA, key: 'es_nif', review: 'none' }),
    ]);
    expect(store.reviews).toEqual([]);

    const first = await send('POST', '/v1/views/completeness', cells);
    const again = await send('POST', '/v1/views/completeness', cells);
    expect(first?.body).toEqual({
      ok: true,
      findings: [expect.objectContaining({ personId: LUCIA, key: 'es_nif', review: 'pending' })],
    });
    expect(again?.body).toEqual(first?.body);
    expect(pending(store)).toEqual(['es_nif']);
  });

  it('a correction, over REST, and its retry answers the same', async () => {
    const { store, send } = world();
    await send('PATCH', `/v1/people/${LUCIA}`, { attributes: { es_nif: '12345678Z' } }, 'w-1');
    expect(store.reviews).toEqual([]);
    const row = store.history.find((h) => h.attributeKey === 'es_nif');
    const body = { supersedes: row?.id, value: WRONG, reason: 'typo' };
    const first = await send('POST', `/v1/people/${LUCIA}/corrections`, body, 'c-1');
    const again = await send('POST', `/v1/people/${LUCIA}/corrections`, body, 'c-1');
    expect(first?.status).toBe(201);
    expect((first?.body as { identifierFindings: unknown }).identifierFindings).toEqual([
      expect.objectContaining({ key: 'es_nif', review: 'pending' }),
    ]);
    expect(again?.body).toEqual(first?.body);
    expect(pending(store)).toEqual(['es_nif']);
    // Keyed to the correction's own history row, which history keeps.
    const correction = store.history.find((h) => h.supersedes === row?.id);
    expect(store.reviews[0]?.historyId).toBe(correction?.id);
  });

  it('an import row: it imports, and its value goes to review', async () => {
    const store = inMemoryPeople([versionOf(1, [...attributes, nif])]);
    const deps = commitDeps(store);
    const file = await parseUpload(
      csv(
        ['Given name', 'Family name', 'Work email', 'Hire date', 'Cost centre', 'NIF'],
        [['Ana', 'Ruiz', 'ana@acme.test', '2026-03-01', 'CC-1', WRONG]],
      ),
    );
    if (!file.ok) throw new Error(file.error.message);
    const version = store.versions[0];
    if (!version) throw new Error('no version');
    const relations = {
      isSelf: false,
      isManager: false,
      isInManagerChain: false,
      isHr: true,
      isFinance: false,
      isAdmin: false,
    };
    const proposed = await proposeMapping({ file: file.value, version, relations, advisor: null });
    const mapping = resolveMapping(proposed, {}, version, relations);
    if (!mapping.ok) throw new Error(mapping.error.message);
    const result = await commitImport(tx, deps, {
      ...importing,
      file: file.value,
      mapping: mapping.value,
    });
    expect(result.ok && result.value.status).toBe('imported');
    expect(result.ok && result.value.status === 'imported' && result.value.findings).toEqual([
      expect.objectContaining({ key: 'es_nif', level: 'mismatch', column: 'NIF' }),
    ]);
    expect(pending(store)).toEqual(['es_nif']);
  });
});
