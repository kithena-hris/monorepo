import { createYoga } from 'graphql-yoga';
import { describe, expect, it } from 'vitest';
import { fixedClock } from '@kithena/domain-kit';
import { createLogger } from '@kithena/telemetry';

import type { Question } from '../http/server.js';
import { compose } from '../composition.js';
import { PEOPLE_CATALOGUE, TIMEOFF_CATALOGUE } from '../domain/fixtures.js';
import { configureGraphQL, yogaOptions } from './schema.js';

/**
 * The subgraph as the router calls it (AST-035): the principal is believed
 * only beside the router–assistant pair's token, and the session it names —
 * a view-as, a support session — reaches every module unchanged. End to end
 * through the composition, over a fake network, a view-as gets People's
 * answers as People gave them and Time Off's refusal in words.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const MARCO = '00000000-0000-4000-8000-0000000000a2';
const TOKEN = 'router-assistant-pair';
const quiet = createLogger({ write: () => undefined });

const principal = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    userId: MARCO,
    tenantId: TENANT,
    impersonatedBy: null,
    viewedBy: null,
    entitlements: ['module.people'],
    ...over,
  });
const routed = (over: Record<string, unknown> = {}) => ({
  'x-internal-token': TOKEN,
  'x-kithena-principal': principal(over),
});

interface Answered {
  data?: { ask?: Record<string, unknown> | null } | null;
  errors?: { message?: string; extensions?: { code?: string } }[];
}

const yoga = createYoga(yogaOptions);
async function ask(question: unknown, headers: Record<string, string>): Promise<Answered> {
  const response = await yoga.fetch('http://assistant/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      query: 'query ($q: String!) { ask(question: $q) { text understood answered people { id name title } } }',
      variables: { q: question },
    }),
  });
  return (await response.json()) as Answered;
}

const ANSWER = { text: 'Hello.', understood: 'Read', people: [], answered: true };

function wired(internalToken = TOKEN) {
  const asked: Question[] = [];
  configureGraphQL({
    internalToken,
    ask: (question) => {
      asked.push(question);
      return Promise.resolve(ANSWER);
    },
  });
  return asked;
}

describe('the assistant subgraph', () => {
  it('believes a principal only when the router sent it, and nobody without a token', async () => {
    wired();
    const stranger = await ask('Who is off today?', { 'x-kithena-principal': principal() });
    expect(stranger.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    const forged = await ask('Who is off today?', { ...routed(), 'x-internal-token': 'guess' });
    expect(forged.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    // `ASSISTANT_API_TOKEN` unset: every question refused, whatever is presented.
    const unset = wired('');
    const refused = await ask('Who is off today?', { ...routed(), 'x-internal-token': '' });
    expect(refused.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');
    expect(unset).toEqual([]);
  });

  it('asks as the signed-in account, in the session the router forwarded, from the web', async () => {
    const asked = wired();
    const answer = await ask('  Who is off today?  ', routed({ viewedBy: ADA }));
    expect(answer.errors).toBeUndefined();
    expect(answer.data?.ask).toEqual(ANSWER);
    expect(asked).toEqual([
      {
        tenantId: TENANT,
        accountId: MARCO,
        impersonatedBy: null,
        viewedBy: ADA,
        question: 'Who is off today?',
        channel: 'web',
      },
    ]);
  });

  it('takes a question of up to 500 characters, and nothing else', async () => {
    const asked = wired();
    for (const question of ['   ', 'x'.repeat(501)]) {
      // oxlint-disable-next-line no-await-in-loop -- one request at a time, each its own case
      const answer = await ask(question, routed());
      expect(answer.errors?.[0]?.extensions?.code).toBe('BAD_REQUEST');
    }
    expect(asked).toEqual([]);
  });
});

/* ------------------------------------------- end to end, a view-as (done) -- */

const SETTINGS = {
  ASSISTANT_API_TOKEN: TOKEN,
  IDENTITY_URL: 'http://identity.test',
  ASSISTANT_IDENTITY_TOKEN: 'identity-pair',
  PEOPLE_URL: 'http://people.test',
  ASSISTANT_PEOPLE_TOKEN: 'people-pair',
  TIMEOFF_URL: 'http://timeoff.test',
  ASSISTANT_TIMEOFF_TOKEN: 'timeoff-pair',
  ASSISTANT_BASE_URL: 'http://model.test/v1',
  ASSISTANT_API_KEY: 'not-a-real-key',
};

const TIMEOFF_SAYS = 'Time Off cannot be used in a support or view-as session';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/**
 * Identity, People, Time Off and a model, answering HTTP as the real ones do:
 * Time Off refuses any session that is not the person's own, as its caller
 * does (`services/timeoff/src/http/caller.ts`); People answers whoever it is
 * sent. The model plans People for "reports", and says Time Off for the rest.
 */
function network() {
  const sent: { url: string; principal: Record<string, unknown> | null; body: string }[] = [];
  const fake = ((url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const raw = headers['x-kithena-principal'];
    const body = typeof init.body === 'string' ? init.body : '';
    sent.push({ url, principal: raw === undefined ? null : JSON.parse(raw), body });
    const session = raw === undefined ? null : (JSON.parse(raw) as Record<string, unknown>);
    if (url.startsWith('http://identity.test/')) {
      return Promise.resolve(
        json({
          accountId: MARCO,
          timeZone: 'Europe/Madrid',
          slug: 'acme',
          entitlements: ['module.people', 'module.timeoff'],
        }),
      );
    }
    if (url.startsWith('http://timeoff.test/')) {
      return Promise.resolve(
        session?.['viewedBy'] === null && session['impersonatedBy'] === null
          ? json(TIMEOFF_CATALOGUE)
          : json({ error: { code: 'FORBIDDEN', message: TIMEOFF_SAYS } }, 403),
      );
    }
    if (url === 'http://people.test/internal/capabilities') {
      return Promise.resolve(json(PEOPLE_CATALOGUE));
    }
    if (url === 'http://people.test/internal/capabilities/people.reports') {
      return Promise.resolve(
        json({
          kind: 'people',
          rows: [{ personId: ADA, name: 'Ben Ode', groups: {} }],
          total: 1,
          scope: 'visible',
          described: 'Marco Ruiz',
          notes: [],
        }),
      );
    }
    if (url === 'http://model.test/v1/chat/completions') {
      const reports = body.includes('Who reports to me?');
      const plan = reports
        ? {
            kind: 'plan',
            steps: [{ id: 's1', capability: 'people.reports', input: { name: 'Marco' } }],
            answer: { kind: 'list', step: 's1' },
          }
        : { kind: 'unavailable', module: 'timeoff' };
      return Promise.resolve(json({ choices: [{ message: { content: JSON.stringify(plan) } }] }));
    }
    return Promise.resolve(json({}, 404));
  }) as typeof fetch;
  return { fake, sent };
}

describe('a view-as session, from the web, end to end', () => {
  const view = routed({ viewedBy: ADA });

  it('gets People’s answer as People gave it, the view forwarded unchanged', async () => {
    const { fake, sent } = network();
    compose(SETTINGS, { fetch: fake, logger: quiet, clock: fixedClock('2026-10-06T10:00:00Z') });
    const answer = await ask('Who reports to me?', view);
    expect(answer.errors).toBeUndefined();
    expect(answer.data?.ask).toMatchObject({
      text: 'Marco Ruiz has 1 direct report:\n• Ben Ode',
      answered: true,
    });
    expect(sent.find((s) => s.url.startsWith('http://identity.test/'))?.body).toBe(
      JSON.stringify({ accountId: MARCO }),
    );
    const toPeople = sent.filter((s) => s.url.startsWith('http://people.test/'));
    expect(toPeople.length).toBeGreaterThan(1);
    for (const s of toPeople) {
      expect(s.principal).toMatchObject({ userId: MARCO, viewedBy: ADA, impersonatedBy: null });
    }
  });

  it('gets Time Off’s refusal in words, never “couldn’t reach” or “doesn’t use”', async () => {
    const { fake } = network();
    compose(SETTINGS, { fetch: fake, logger: quiet, clock: fixedClock('2026-10-06T10:00:00Z') });
    const answer = await ask('Who is off today?', view);
    expect(answer.errors).toBeUndefined();
    expect(answer.data?.ask).toEqual({
      text: TIMEOFF_SAYS,
      understood: 'Time Off refused',
      answered: false,
      people: [],
    });
  });

  it('as the person themselves, Time Off answers as before', async () => {
    const { fake, sent } = network();
    compose(SETTINGS, { fetch: fake, logger: quiet, clock: fixedClock('2026-10-06T10:00:00Z') });
    await ask('Who is off today?', routed());
    const catalogue = sent.find((s) => s.url === 'http://timeoff.test/internal/capabilities');
    expect(catalogue?.principal).toMatchObject({ viewedBy: null, impersonatedBy: null });
  });
});
