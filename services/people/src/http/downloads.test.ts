import { describe, expect, it } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { ok } from '@kithena/domain-kit';

import { define, inMemoryPeople, TENANT, versionOf } from '../application/person/in-memory.js';
import { personAccess } from '../application/person/person-access.js';
import type { PeopleService } from '../application/person/service.js';
import { configureGraphQL, schema } from '../graphql/schema.js';
import type { CallerFrom } from './caller.js';
import { inMemoryIdempotency } from './idempotency.js';
import { restHandler } from './rest.js';
import { screenRoutes, type ScreenRouteDeps } from './screens.js';

/**
 * A People CSV, from the route to the GraphQL field the tenant app's download
 * routes read: the bytes over REST, typed as CSV; the same bytes as text over
 * GraphQL, byte order mark and all; and the refusal where the viewer may not.
 */

const HR_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';
const ANYBODY = '00000000-0000-4000-8000-0000000000b4';

function transports(account: string, roles: string[]) {
  const store = inMemoryPeople([
    versionOf(1, [
      define({ key: 'given_name', label: { default: 'First name' } }),
      define({ key: 'job_title', label: { default: 'Job title' } }),
    ]),
  ]);
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
  const deps = {
    service,
    relations: store.deps.relations,
    clock: store.deps.clock,
    commit: { reports: { store: {} } },
  };
  const rest = restHandler({
    service,
    callerFrom,
    idempotency: inMemoryIdempotency(),
    screens: screenRoutes(deps as unknown as ScreenRouteDeps, inMemoryIdempotency()),
  });
  configureGraphQL({ service, callerFrom, rest });
  const yoga = createYoga({ schema, maskedErrors: false });
  const graphql = async (query: string) => {
    const response = await yoga.fetch('http://people.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    return (await response.json()) as {
      data: Record<string, unknown> | null;
      errors?: { extensions?: { code?: string } }[];
    };
  };
  return { rest, graphql };
}

const TEMPLATE = '﻿First name,Job title\r\n';

describe('the import template, end to end', () => {
  it('is a CSV file over REST', async () => {
    const { rest } = transports(HR_ACCOUNT, ['hr']);
    const answer = await rest({ method: 'GET', url: '/v1/imports/template', headers: {}, body: '' });
    expect(answer?.status).toBe(200);
    expect(answer?.headers).toMatchObject({
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="people-import-template.csv"',
    });
    expect(Buffer.from(answer?.body as Uint8Array).toString('utf8')).toBe(TEMPLATE);
  });

  it('is the same text over GraphQL, for the download route to hand over', async () => {
    const { graphql } = transports(HR_ACCOUNT, ['hr']);
    expect((await graphql('{ peopleImportTemplate }')).data).toEqual({
      peopleImportTemplate: TEMPLATE,
    });
  });

  it('is HR’s, as importing is', async () => {
    const { graphql } = transports(ANYBODY, []);
    const answer = await graphql('{ peopleImportTemplate }');
    expect(answer.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});

describe('an Insights tab as CSV', () => {
  it('names only the four tabs', async () => {
    const { rest } = transports(HR_ACCOUNT, ['hr']);
    const answer = await rest({
      method: 'GET',
      url: '/v1/views/analytics/export?tab=salaries',
      headers: {},
      body: '',
    });
    expect(answer?.body).toMatchObject({ error: { code: 'BAD_REQUEST', path: ['tab'] } });
  });
});

describe('the import and export history', () => {
  it('says it is not kept where no store is wired, rather than answering empty', async () => {
    const { graphql } = transports(HR_ACCOUNT, ['hr']);
    const answer = await graphql('{ peopleTransferHistory { next } }');
    expect(answer.errors?.[0]?.extensions?.code).toBe('UNAVAILABLE');
  });
});
