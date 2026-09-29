import { createYoga } from 'graphql-yoga';
import { describe, expect, it } from 'vitest';

import type { EntryStore } from '../application/ports.js';
import { readActivity } from '../application/read.js';
import type { Filter } from '../domain/reading.js';
import { configureGraphQL, yogaOptions } from './schema.js';

/**
 * The subgraph as the router calls it: the principal is believed only beside
 * the router's token, and the address's filters arrive as the store's.
 */

const TENANT = '00000000-0000-4000-8000-000000000001';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const TOKEN = 'router-token';

function wired(roles: string[]) {
  const asked: Filter[] = [];
  const store: EntryStore = {
    append: () => Promise.resolve(true),
    page: (_t, q) => {
      asked.push(q.filter);
      return Promise.resolve([]);
    },
  };
  configureGraphQL({
    read: readActivity({ store, readers: { roles: () => Promise.resolve(new Set(roles)) } }),
    internalToken: TOKEN,
  });
  const yoga = createYoga(yogaOptions);
  const ask = async (query: string, headers: Record<string, string>) => {
    const response = await yoga.fetch('http://audit/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ query }),
    });
    return (await response.json()) as {
      data?: unknown;
      errors?: { extensions?: { code?: string } }[];
    };
  };
  return { ask, asked };
}

const principal = JSON.stringify({ userId: ADA, tenantId: TENANT, impersonatedBy: null });
const routed = { 'x-internal-token': TOKEN, 'x-kithena-principal': principal };

describe('the audit subgraph', () => {
  it('believes a principal only when the router sent it', async () => {
    const { ask } = wired(['hr']);
    const answer = await ask('{ auditActivity { next } }', { 'x-kithena-principal': principal });
    expect(answer.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  it('refuses a reader who is neither an administrator nor HR', async () => {
    const { ask } = wired(['finance']);
    const answer = await ask('{ auditActivity { next } }', routed);
    expect(answer.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });

  it('hands the address’s filters to the log, days on the reader’s clock', async () => {
    const { ask, asked } = wired(['people_admin']);
    const answer = await ask(
      `{ auditActivity(areas: ["roles", "sign_in"], by: "support", from: "2026-09-01", to: "2026-09-01",
         zone: "Europe/Madrid", search: "role") { entries { id } next } }`,
      routed,
    );
    expect(answer.errors).toBeUndefined();
    expect(asked[0]).toEqual({
      areas: ['roles', 'sign_in'],
      actorKind: 'support',
      actor: null,
      subject: null,
      from: '2026-08-31T22:00:00.000Z',
      until: '2026-09-01T22:00:00.000Z',
      search: 'role',
    });
  });

  it('refuses a filter it does not have rather than ignoring it', async () => {
    const { ask } = wired(['hr']);
    const answer = await ask('{ auditActivity(areas: ["payroll"]) { next } }', routed);
    expect(answer.errors?.[0]?.extensions?.code).toBe('BAD_REQUEST');
  });
});
